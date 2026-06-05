// Export full card metadata for every transcended hero.
// Reads the indexed roster IDs, batches getHeroV3() via Multicall3 on each chain,
// decodes to flat card attributes, and writes JSON + CSV.
//
//   node scripts/export-metadata.mjs            # full roster, resumable
//   node scripts/export-metadata.mjs --sample 30   # quick preview
//   node scripts/export-metadata.mjs --assemble    # rebuild json/csv from checkpoint only
//
// Robust against a flaky/rate-limited public RPC: every request has a timeout
// (it fails fast instead of hanging), batches run with modest concurrency, and
// every completed batch is appended to a checkpoint file. A re-run resumes from
// the checkpoint, so a stall or kill never loses progress.
import { createPublicClient, fallback, http } from 'viem';
import { readFileSync, appendFileSync, existsSync, mkdirSync, createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeHero } from '../lib/decode.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data');
const abiFull = JSON.parse(readFileSync(join(__dirname, '..', 'abi', 'HeroCoreDiamond.json'), 'utf8'));
const heroAbi = Array.isArray(abiFull) ? abiFull : abiFull.abi;
const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const SAMPLE = process.argv.includes('--sample') ? Number(arg('--sample')) : 0;
const ASSEMBLE_ONLY = process.argv.includes('--assemble');
const BATCH = 100;        // heroes per multicall (smaller = less likely to be throttled)
const CONCURRENCY = 4;    // parallel batches
const REQ_TIMEOUT = 25000;

const CHAINS = {
  dfkchain: { id: 53935, rpcs: ['https://dfk-chain.rpc.thirdweb.com/', 'https://subnets.avax.network/defi-kingdoms/dfk-chain/rpc'],
              herocore: '0xEb9B61B145D6489Be575D3603F4a704810e143dF', raw: 'transcended-dfkchain.json' },
  kaia: { id: 8217, rpcs: ['https://kaia.rpc.defikingdoms.com/', 'https://public-en.node.kaia.io', 'https://rpc.ankr.com/kaia'],
          herocore: '0x268CC8248FFB72Cd5F3e73A9a20Fa2FF40EfbA61', raw: 'transcended-kaia.json' },
};

const ckptPath = (chain) => join(DATA, `.metadata-${chain}.jsonl`);
// Checkpoints grow past Node's single-string limit (~536MB) on the full
// roster, so they are always read line by line, never readFileSync'd whole.
async function eachCheckpointLine(chain, fn) {
  if (!existsSync(ckptPath(chain))) return;
  const rl = createInterface({ input: createReadStream(ckptPath(chain), 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    await fn(parsed, line);
  }
}
async function readCheckpointIds(chain) {
  const ids = new Set();
  await eachCheckpointLine(chain, (h) => ids.add(h.heroId));
  return ids;
}

function clientFor(c) {
  const rpcs = c.rpcs ?? [c.rpc];
  const transports = rpcs.map(rpc => http(rpc, { timeout: REQ_TIMEOUT, retryCount: 1, retryDelay: 800, batch: true }));
  return createPublicClient({
    chain: { id: c.id, name: 'c', nativeCurrency: { name: 'x', symbol: 'x', decimals: 18 }, rpcUrls: { default: { http: rpcs } },
             contracts: { multicall3: { address: MULTICALL } } },
    transport: transports.length > 1 ? fallback(transports, { retryCount: 0 }) : transports[0],
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function fetchBatch(client, herocore, ids) {
  // multicall with a hard timeout; on failure, split and retry, then per-hero
  const calls = ids.map(id => ({ address: herocore, abi: heroAbi, functionName: 'getHeroV3', args: [BigInt(id)] }));
  try {
    const results = await withTimeout(client.multicall({ contracts: calls, allowFailure: true }), REQ_TIMEOUT, `multicall ${ids.length}`);
    return ids.map((id, i) => results[i]?.status === 'success' ? { id, hero: results[i].result } : { id, hero: null });
  } catch {
    if (ids.length > 1) { // split and retry each half
      const mid = Math.floor(ids.length / 2);
      const [a, b] = await Promise.all([fetchBatch(client, herocore, ids.slice(0, mid)), fetchBatch(client, herocore, ids.slice(mid))]);
      return [...a, ...b];
    }
    // single hero, last resort: direct read
    try { return [{ id: ids[0], hero: await withTimeout(client.readContract(calls[0]), REQ_TIMEOUT, `getHero ${ids[0]}`) }]; } catch { return [{ id: ids[0], hero: null }]; }
  }
}

async function pool(items, n, fn, onProgress) {
  const arr = [...items]; let done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (arr.length) { const it = arr.shift(); await fn(it); onProgress(++done); }
  }));
}

async function runChain(chain, cfg) {
  const rawPath = join(DATA, 'raw', cfg.raw);
  if (!existsSync(rawPath)) { console.log(`(${chain}: no raw file, skipping)`); return; }
  const rawEvents = JSON.parse(readFileSync(rawPath, 'utf8'));
  const eventsByHero = new Map();
  for (const e of rawEvents) {
    const id = String(e.heroId);
    if (!eventsByHero.has(id)) eventsByHero.set(id, e);
  }
  let ids = [...eventsByHero.keys()];
  if (SAMPLE) ids = ids.slice(0, SAMPLE);

  const have = await readCheckpointIds(chain);
  const todo = ids.filter(id => !have.has(id));
  console.log(`${chain}: ${ids.length} heroes (${have.size} already done, ${todo.length} to fetch)`);
  if (!todo.length) return;

  const client = clientFor(cfg);
  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  let fetched = 0, failed = 0;
  mkdirSync(DATA, { recursive: true });
  await pool(batches, CONCURRENCY, async (slice) => {
    const out = await fetchBatch(client, cfg.herocore, slice);
    const lines = [];
    for (const { hero } of out) {
      if (hero) { try { lines.push(JSON.stringify(decodeHero(hero, chain, eventsByHero.get(String(hero.id))))); fetched++; } catch { failed++; } }
      else failed++;
    }
    if (lines.length) appendFileSync(ckptPath(chain), lines.join('\n') + '\n'); // checkpoint
  }, (batchesDone) => {
    if (batchesDone % 20 === 0 || batchesDone === batches.length)
      console.log(`  ${chain}: ${Math.min(batchesDone * BATCH, todo.length)}/${todo.length} (${failed} failed)`);
  });
  console.log(`  ${chain}: done fetching (${fetched} ok, ${failed} failed)`);
}

// Streaming writer with backpressure, the full dataset never lives in memory.
function lineWriter(path) {
  const out = createWriteStream(path);
  return {
    write: (s) => out.write(s) ? Promise.resolve() : new Promise(r => out.once('drain', r)),
    end: () => new Promise((r) => out.end(r)),
  };
}

async function assemble() {
  const chains = Object.keys(CHAINS);
  const tag = SAMPLE ? `-sample${SAMPLE}` : '';

  // Pass 1: column union + dedup count (checkpoints can hold a hero twice if
  // a run was killed mid-batch; first occurrence wins).
  const cols = [];
  const colSet = new Set();
  const seen = new Set();
  let first = null;
  for (const chain of chains) {
    await eachCheckpointLine(chain, (h) => {
      if (seen.has(h.heroId)) return;
      seen.add(h.heroId);
      if (!first) first = h;
      for (const k of Object.keys(h)) {
        if ((h[k] === null || typeof h[k] !== 'object') && !colSet.has(k)) { colSet.add(k); cols.push(k); }
      }
    });
  }
  if (!seen.size) { console.log('nothing in checkpoints yet'); return; }
  const total = seen.size;

  // Pass 2: stream JSON (one record per line) and CSV side by side.
  seen.clear();
  const json = lineWriter(join(DATA, `hero-metadata${tag}.json`));
  const csv = lineWriter(join(DATA, `hero-metadata${tag}.csv`));
  await json.write('[\n');
  await csv.write(cols.join(',') + '\n');
  const esc = (v) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let written = 0;
  for (const chain of chains) {
    await eachCheckpointLine(chain, async (h, line) => {
      if (seen.has(h.heroId)) return;
      seen.add(h.heroId);
      written++;
      await json.write(line + (written < total ? ',\n' : '\n'));
      await csv.write(cols.map(c => esc(h[c])).join(',') + '\n');
    });
  }
  await json.write(']\n');
  await Promise.all([json.end(), csv.end()]);
  console.log(`\nassembled ${written} heroes (${cols.length} columns) -> data/hero-metadata${tag}.json + .csv`);
  if (SAMPLE && first) console.log(JSON.stringify(first, null, 2));
}

if (!ASSEMBLE_ONLY) for (const [chain, cfg] of Object.entries(CHAINS)) await runChain(chain, cfg);
await assemble();
