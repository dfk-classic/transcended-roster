// Independent verification of the metadata export's gene decode.
//
//   node scripts/verify-decode.mjs [data/hero-metadata-sample20.json]
//
// Re-derives every gene field from the raw statGenes/visualGenes integers
// using a separate implementation (direct base-32 digit extraction, no shared
// decode path), then asserts the exported columns match. Catches any trait
// order, slot order, or pipeline bug in lib/decode.mjs.
//
// The enum name maps themselves are imported from lib/decode.mjs; their
// content is anchored separately (verified identical to HONK Marketplace's
// heroUtils.js mappings).
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { MAPS, STAT_TRAITS, VISUAL_TRAITS } from '../lib/decode.mjs';

const file = process.argv[2] || 'data/hero-metadata-sample20.json';

// The full export is larger than Node's single-string limit, so read it line
// by line. Works for both the one-record-per-line full export and the
// pretty-printed sample (which is small enough to buffer and re-split).
async function* readRecords(path) {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let buf = '';
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (line === '[' || line === ']' || line === '') continue;
    const candidate = line.endsWith(',') ? line.slice(0, -1) : line;
    if (buf === '' && candidate.startsWith('{') && candidate.endsWith('}')) {
      try { yield JSON.parse(candidate); continue; } catch {}
    }
    // pretty-printed fallback: accumulate until the chunk parses
    buf += rawLine + '\n';
    const chunk = buf.trim().replace(/,$/, '');
    if (chunk.startsWith('{') && chunk.endsWith('}')) {
      try { yield JSON.parse(chunk); buf = ''; } catch {}
    }
  }
}

// Independent decode: the kai string is just the base-32 digits of the gene
// integer (alphabet index == digit value), so extract digits numerically.
// 48 digits, 12 trait groups of 4, group order within: [r3, r2, r1, dominant].
function base32Digits(genesStr) {
  let n = BigInt(genesStr);
  const digits = [];
  while (n > 0n) { digits.unshift(Number(n % 32n)); n /= 32n; }
  while (digits.length < 48) digits.unshift(0);
  return digits;
}
function groupsOf(genesStr) {
  const d = base32Digits(genesStr);
  return Array.from({ length: 12 }, (_, t) => ({
    r3: d[t * 4], r2: d[t * 4 + 1], r1: d[t * 4 + 2], dominant: d[t * 4 + 3],
  }));
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const nameFor = (trait, value) => {
  const m = {
    mainClass: ['CLASSES', 'class'], subClass: ['CLASSES', 'class'],
    profession: ['PROFESSION', 'profession'],
    passive1: ['PASSIVE', 'passive'], passive2: ['PASSIVE', 'passive'],
    active1: ['ACTIVE', 'active'], active2: ['ACTIVE', 'active'],
    statBoost1: ['STAT_BOOST', 'boost'], statBoost2: ['STAT_BOOST', 'boost'],
    crafting1: ['CRAFTING', 'crafting'], crafting2: ['CRAFTING', 'crafting'],
    element: ['ELEMENT', 'element'],
    gender: ['GENDER', 'gender'], background: ['BACKGROUND', 'bg'],
  }[trait];
  if (!m) return value; // numeric visual traits pass through
  return MAPS[m[0]][value] ?? `${m[1]}${value}`;
};

const SLOTS = [['dominant', ''], ['r1', 'Recessive1'], ['r2', 'Recessive2'], ['r3', 'Recessive3']];
let checked = 0, failed = 0, count = 0;
const fail = (id, what, want, got) => { failed++; console.log(`FAIL hero ${id}: ${what} expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`); };

for await (const h of readRecords(file)) {
  count++;
  if (count % 25000 === 0) console.log(`  ...${count} heroes checked`);
  const statGroups = groupsOf(h.statGenes);
  const visualGroups = groupsOf(h.visualGenes);
  const check = (what, want, got) => { checked++; if (String(want) !== String(got)) fail(h.heroId, what, want, got); };

  for (const [groups, traits, prefix] of [[statGroups, STAT_TRAITS, 'statGene'], [visualGroups, VISUAL_TRAITS, 'visualGene']]) {
    for (const [i, trait] of traits.entries()) {
      for (const [slot, label] of SLOTS) {
        const raw = groups[i][slot];
        check(`${prefix}${label}${cap(trait)}Raw`, raw, h[`${prefix}${label}${cap(trait)}Raw`]);
        check(`${prefix}${label}${cap(trait)}`, nameFor(trait, raw), h[`${prefix}${label}${cap(trait)}`]);
      }
    }
  }

  // Top-level convenience fields must equal the dominant stat genes.
  const dom = Object.fromEntries(STAT_TRAITS.map((t, i) => [t, statGroups[i].dominant]));
  check('element', nameFor('element', dom.element), h.element);
  check('profession', nameFor('profession', dom.profession), h.profession);
  for (const t of ['active1', 'active2', 'passive1', 'passive2', 'statBoost1', 'statBoost2', 'crafting1', 'crafting2'])
    check(t, nameFor(t, dom[t]), h[t]);
  check('gender', nameFor('gender', visualGroups[0].dominant), h.gender);
  check('background', nameFor('background', visualGroups[3].dominant), h.background);

  // Derived numbers: growth Pct = raw / 100, profession skill = raw / 10.
  for (const p of ['primary', 'secondary'])
    for (const s of ['Strength', 'Intelligence', 'Wisdom', 'Luck', 'Agility', 'Vitality', 'Endurance', 'Dexterity', 'HpSm', 'HpRg', 'HpLg', 'MpSm', 'MpRg', 'MpLg'])
      check(`${p}${s}GrowthPct`, h[`${p}${s}Growth`] / 100, h[`${p}${s}GrowthPct`]);
  for (const s of ['mining', 'gardening', 'foraging', 'fishing', 'craft1', 'craft2'])
    check(`${s}Skill`, h[s] / 10, h[`${s}Skill`]);
}

console.log(`${count} heroes, ${checked} assertions, ${failed} failures`);
process.exit(failed ? 1 : 0);
