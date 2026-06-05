// Index all HeroTranscended events on Kaia (Serendale) via DFK's public RPC.
// Adaptive block-range chunking. Output: data/raw/transcended-kaia.json
import { writeFileSync, mkdirSync } from 'node:fs';

const RPC = 'https://kaia.rpc.defikingdoms.com/';
const HEROCORE_KAIA = '0x268CC8248FFB72Cd5F3e73A9a20Fa2FF40EfbA61';
const TOPIC = '0xe0b50343ad292b1895adf59cc0a6dbffbcee0ba29a81edc4b9794a0acec9bd93'; // HeroTranscended

let rpcId = 1;
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}
const blockTs = async (n) => parseInt((await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), false])).timestamp, 16);

// find start block (just before Divine Altar launch 2025-05-29) by binary search
const TARGET = Math.floor(Date.parse('2025-05-29T00:00:00Z') / 1000);
const latest = parseInt(await rpc('eth_blockNumber', []), 16);
let lo = 150_000_000, hi = latest;
while (hi - lo > 1000) {
  const mid = Math.floor((lo + hi) / 2);
  (await blockTs(mid)) < TARGET ? (lo = mid) : (hi = mid);
}
console.log(`Kaia: latest block ${latest}, start block ~${lo}`);

const seen = new Map();
let from = lo, span = 1_000_000;
while (from <= latest) {
  const to = Math.min(from + span, latest);
  try {
    const logs = await rpc('eth_getLogs', [{ address: HEROCORE_KAIA, topics: [TOPIC],
      fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]);
    for (const l of logs) {
      const key = `${l.transactionHash}:${parseInt(l.logIndex, 16)}`;
      if (!seen.has(key)) seen.set(key, {
        heroId: BigInt(l.topics[1]).toString(),
        owner: '0x' + l.topics[2].slice(26),
        block: parseInt(l.blockNumber, 16),
      });
    }
    from = to + 1;
    if (logs.length < 500) span = Math.min(span * 2, 4_000_000);
  } catch (e) {
    span = Math.floor(span / 4); // RPC rejected the range (shrink and retry)
    if (span < 1000) throw new Error('range too small, RPC refuses: ' + e.message);
  }
}
const kaia = [...seen.values()].sort((a, b) => a.block - b.block);
console.log(`Kaia HeroTranscended events: ${kaia.length}`);
console.log(`unique heroIds: ${new Set(kaia.map(e => e.heroId)).size}`);

mkdirSync(new URL('../data/raw/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/raw/transcended-kaia.json', import.meta.url), JSON.stringify(kaia, null, 1));
console.log('wrote data/raw/transcended-kaia.json');
