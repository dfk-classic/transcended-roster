// Index all HeroTranscended events on DFK Chain via Routescan's public API.
// Cursor-paged by block with dedupe (immune to API page caps).
// Output: data/raw/transcended-dfkchain.json
import { writeFileSync, mkdirSync } from 'node:fs';

const HEROCORE = '0xEb9B61B145D6489Be575D3603F4a704810e143dF';
const TOPIC = '0xe0b50343ad292b1895adf59cc0a6dbffbcee0ba29a81edc4b9794a0acec9bd93'; // HeroTranscended
const API = 'https://api.routescan.io/v2/network/mainnet/evm/53935/etherscan/api';
const START_BLOCK = 48131000; // just before the first transcend (2025-05-29)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const seen = new Map();
let cursor = START_BLOCK;
let pages = 0;

while (true) {
  const url = `${API}?module=logs&action=getLogs&address=${HEROCORE}&topic0=${TOPIC}&fromBlock=${cursor}&toBlock=latest&page=1&offset=1000`;
  let j;
  try { j = await (await fetch(url)).json(); }
  catch (e) { console.log('fetch error, retrying:', e.message); await sleep(2000); continue; }
  const logs = Array.isArray(j.result) ? j.result : [];
  if (!logs.length) break;
  let maxBlock = cursor;
  for (const l of logs) {
    const key = `${l.transactionHash}:${parseInt(l.logIndex || '0x0')}`;
    if (!seen.has(key)) {
      seen.set(key, {
        heroId: BigInt(l.topics[1]).toString(),
        owner: '0x' + l.topics[2].slice(26),
        block: parseInt(l.blockNumber),
        ts: parseInt(l.timeStamp),
      });
    }
    maxBlock = Math.max(maxBlock, parseInt(l.blockNumber));
  }
  pages++;
  if (pages % 10 === 0) console.log(`page ${pages}: ${seen.size} events, cursor block ${maxBlock}`);
  if (logs.length < 1000) break;
  if (maxBlock === cursor) break; // safety: should never happen
  cursor = maxBlock; // overlap last block; dedupe handles repeats
  await sleep(350);
}

const all = [...seen.values()].sort((a, b) => a.block - b.block);
console.log(`\nDFK Chain HeroTranscended events: ${all.length}`);
console.log(`unique heroIds: ${new Set(all.map(e => e.heroId)).size}`);

mkdirSync(new URL('../data/raw/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/raw/transcended-dfkchain.json', import.meta.url), JSON.stringify(all, null, 1));
console.log('wrote data/raw/transcended-dfkchain.json');
