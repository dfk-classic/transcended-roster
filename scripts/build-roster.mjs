// Build the deduped roster (CSV + XLSX) from the raw event files.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import XLSX from 'xlsx';

const dfk = JSON.parse(readFileSync(new URL('../data/raw/transcended-dfkchain.json', import.meta.url)));
const kaia = JSON.parse(readFileSync(new URL('../data/raw/transcended-kaia.json', import.meta.url)));

const seen = new Set();
const rows = [];
for (const e of dfk) {
  if (seen.has(e.heroId)) continue;
  seen.add(e.heroId);
  rows.push([e.heroId, 'dfkchain', e.block, new Date(e.ts * 1000).toISOString().slice(0, 10)]);
}
let kaiaAdded = 0;
for (const e of kaia) {
  if (seen.has(e.heroId)) continue;
  seen.add(e.heroId);
  rows.push([e.heroId, 'kaia', e.block, '']);
  kaiaAdded++;
}
rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
console.log(`unique heroes: ${rows.length} (dfkchain ${rows.length - kaiaAdded} + kaia ${kaiaAdded})`);

// CSV (full, incl. block numbers)
const csv = 'heroId,chain,block,transcendedDate\n' + rows.map(r => r.join(',')).join('\n');
const csvPath = new URL('../data/transcended-roster.csv', import.meta.url);
writeFileSync(csvPath, csv);
console.log(`csv:  ${Math.round(csv.length / 1024 / 1024 * 10) / 10} MB`);

// XLSX (heroId as text so Excel doesn't mangle it into scientific notation)
const data = [['heroId', 'chain', 'transcendedDate'], ...rows.map(r => [{ v: r[0], t: 's' }, r[1], r[3]])];
const ws = XLSX.utils.aoa_to_sheet(data);
ws['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 14 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Transcended Roster');
const xlsxPath = new URL('../data/transcended-roster.xlsx', import.meta.url);
XLSX.writeFile(wb, xlsxPath.pathname.replace(/^\/([A-Za-z]:)/, '$1'), { compression: true });
console.log(`xlsx: ${Math.round(statSync(xlsxPath).size / 1024 / 1024 * 10) / 10} MB`);
