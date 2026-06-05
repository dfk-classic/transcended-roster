// Decode a raw getHero() struct into a flat, card-ready attribute object.
//
// The headline attributes (class, subClass, rarity, generation, shiny, level,
// stats) come straight from the struct, no gene science needed. Element,
// profession, stat boosts, abilities and visual traits are decoded from the
// kai-base32 gene strings. Raw statGenes/visualGenes are kept so any further
// decode is possible downstream.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadList = (p) => new Function('return ' + readFileSync(join(__dirname, '..', 'abi', p), 'utf8'))();
const maleNames = loadList('maleFirstNames.json');
const femaleNames = loadList('femaleFirstNames.json');
const lastNames = loadList('lastNames.json');

const CLASSES = { 0: 'Warrior', 1: 'Knight', 2: 'Thief', 3: 'Archer', 4: 'Priest', 5: 'Wizard',
  6: 'Monk', 7: 'Pirate', 8: 'Berserker', 9: 'Seer', 10: 'Legionnaire', 11: 'Scholar',
  16: 'Paladin', 17: 'DarkKnight', 18: 'Summoner', 19: 'Ninja', 20: 'Shapeshifter',
  21: 'Bard', 24: 'Dragoon', 25: 'Sage', 26: 'SpellBow', 28: 'DreadKnight' };
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Mythic'];
const GENDER = { 1: 'male', 3: 'female' };
// mappings aligned to HONK Marketplace (src/utils/heroUtils.js) so this dataset
// matches what HONK shows for the same hero.
const BACKGROUND = { 0: 'desert', 2: 'forest', 4: 'plains', 6: 'island', 8: 'swamp', 10: 'mountains', 12: 'city', 14: 'arctic' };
const ELEMENT = { 0: 'fire', 2: 'water', 4: 'earth', 6: 'wind', 8: 'lightning', 10: 'ice', 12: 'light', 14: 'dark' };
const PROFESSION = { 0: 'mining', 2: 'gardening', 4: 'fishing', 6: 'foraging' };
const STAT_BOOST = { 0: 'STR', 2: 'AGI', 4: 'INT', 6: 'WIS', 8: 'LCK', 10: 'VIT', 12: 'END', 14: 'DEX' };
const CRAFTING = { 0: 'Blacksmithing', 2: 'Goldsmithing', 4: 'Armorsmithing', 6: 'Woodworking',
  8: 'Leatherworking', 10: 'Tailoring', 12: 'Enchanting', 14: 'Alchemy' };
const ACTIVE = { 0: 'Poisoned Blade (Basic1)', 1: 'Blinding Winds (Basic2)', 2: 'Heal (Basic3)', 3: 'Cleanse (Basic4)',
  4: 'Iron Skin (Basic5)', 5: 'Critical Aim (Basic6)', 6: 'Speed (Basic7)', 7: 'Deathmark (Basic8)',
  16: 'Exhaust (Advanced1)', 17: 'Daze (Advanced2)', 18: 'Explosion (Advanced3)', 19: 'Hardened Shield (Advanced4)',
  24: 'Stun (Elite1)', 25: 'Second Wind (Elite2)', 28: 'Resurrection (Exalted1)' };
const PASSIVE = { 0: 'Duelist (Basic1)', 1: 'Clutch (Basic2)', 2: 'Foresight (Basic3)', 3: 'Headstrong (Basic4)',
  4: 'Clear Vision (Basic5)', 5: 'Fearless (Basic6)', 6: 'Chatterbox (Basic7)', 7: 'Stalwart (Basic8)',
  16: 'Leadership (Advanced1)', 17: 'Efficient (Advanced2)', 18: 'Menacing (Advanced3)', 19: 'Toxic (Advanced4)',
  24: 'Giant Slayer (Elite1)', 25: 'Last Stand (Elite2)', 28: 'Second Life (Exalted1)' };

// kai base-32 gene decode (dominant gene = last of each 4-gene group)
const ALPHABET = '123456789abcdefghijkmnopqrstuvwx';
function genesToKai(genes) {
  const BASE = 32n; let buf = '';
  while (genes >= BASE) { const mod = genes % BASE; buf = ALPHABET[Number(mod)] + buf; genes = (genes - mod) / BASE; }
  buf = ALPHABET[Number(genes)] + buf;
  return buf.padStart(48, '1');
}
const geneGroups = (genesStr) => {
  const kai = genesToKai(BigInt(genesStr));
  return Array.from({ length: 12 }, (_, t) => {
    const chars = kai.slice(t * 4, t * 4 + 4);
    return {
      r3: ALPHABET.indexOf(chars[0]),
      r2: ALPHABET.indexOf(chars[1]),
      r1: ALPHABET.indexOf(chars[2]),
      dominant: ALPHABET.indexOf(chars[3]),
    };
  });
};
const dominant = (groups) => groups.map(g => g.dominant);
const STAT = ['mainClass', 'subClass', 'profession', 'passive1', 'passive2', 'active1', 'active2', 'statBoost1', 'statBoost2', 'crafting1', 'element', 'crafting2'];
const VIS = ['gender', 'headAppendage', 'backAppendage', 'background', 'hairStyle', 'hairColor', 'visualUnknown1', 'eyeColor', 'skinColor', 'appendageColor', 'backAppendageColor', 'visualUnknown2'];
const GROWTH = ['strength', 'intelligence', 'wisdom', 'luck', 'agility', 'vitality', 'endurance', 'dexterity', 'hpSm', 'hpRg', 'hpLg', 'mpSm', 'mpRg', 'mpLg'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const growthFields = (growth, prefix) => Object.fromEntries(GROWTH.flatMap((key) => {
  const value = growth[key];
  return [[`${prefix}${cap(key)}Growth`, value], [`${prefix}${cap(key)}GrowthPct`, value / 100]];
}));
const mapStatGene = (trait, value) => {
  if (trait === 'mainClass' || trait === 'subClass') return CLASSES[value] ?? `class${value}`;
  if (trait === 'profession') return PROFESSION[value] ?? `profession${value}`;
  if (trait === 'passive1' || trait === 'passive2') return PASSIVE[value] ?? `passive${value}`;
  if (trait === 'active1' || trait === 'active2') return ACTIVE[value] ?? `active${value}`;
  if (trait === 'statBoost1' || trait === 'statBoost2') return STAT_BOOST[value] ?? `boost${value}`;
  if (trait === 'crafting1' || trait === 'crafting2') return CRAFTING[value] ?? `crafting${value}`;
  if (trait === 'element') return ELEMENT[value] ?? `element${value}`;
  return value;
};
const mapVisualGene = (trait, value) => {
  if (trait === 'gender') return GENDER[value] ?? `gender${value}`;
  if (trait === 'background') return BACKGROUND[value] ?? `bg${value}`;
  return value;
};
const geneFields = (groups, traits, prefix, mapper) => {
  const out = {};
  const slots = [['dominant', ''], ['r1', 'Recessive1'], ['r2', 'Recessive2'], ['r3', 'Recessive3']];
  for (const [index, trait] of traits.entries()) {
    const name = cap(trait);
    for (const [slot, label] of slots) {
      const value = groups[index][slot];
      out[`${prefix}${label}${name}`] = mapper(trait, value);
      out[`${prefix}${label}${name}Raw`] = value;
    }
  }
  return out;
};

// All enum maps in one place, verified identical to HONK Marketplace's
// heroUtils.js (classMapping, rarityMapping, elementMapping, professionMapping,
// backgroundMapping, statsMapping, activeAbilityMapping, passiveAbilityMapping).
export const MAPS = { CLASSES, RARITIES, GENDER, BACKGROUND, ELEMENT, PROFESSION, STAT_BOOST, CRAFTING, ACTIVE, PASSIVE };
export const STAT_TRAITS = STAT;
export const VISUAL_TRAITS = VIS;

// Standalone gene translator: raw gene integers (string or bigint) in, every
// trait fully mapped out. Returns, per trait, all four slots:
//   { dominant: {name, raw}, r1: {name, raw}, r2: {name, raw}, r3: {name, raw} }
// Slot positions follow the DFK kai encoding (per 4-char trait group:
// char1=r3, char2=r2, char3=r1, char4=dominant), same as HONK's parser.
// Note on HONK: HONK's recessive DISPLAY swaps active1/active2
// (heroGeneParser.js formatRecessiveStatGenes, commented "SWAP"). That swap has
// no basis in the gene encoding (dominants and passives are not swapped), so
// this translator keeps documented trait order and does NOT swap.
export function translateGenes(statGenes, visualGenes) {
  const slotted = (groups, traits, mapper) => Object.fromEntries(traits.map((trait, i) => [trait,
    Object.fromEntries(['dominant', 'r1', 'r2', 'r3'].map((slot) => {
      const raw = groups[i][slot];
      return [slot, { name: mapper(trait, raw), raw }];
    })),
  ]));
  return {
    stat: slotted(geneGroups(statGenes), STAT, mapStatGene),
    visual: slotted(geneGroups(visualGenes), VIS, mapVisualGene),
  };
}

export function decodeHero(h, chain, meta = {}) {
  const i = h.info, s = h.stats, st = h.state, su = h.summoningInfo, p = h.professions;
  const statGroups = geneGroups(i.statGenes);
  const visualGroups = geneGroups(i.visualGenes);
  const sg = Object.fromEntries(dominant(statGroups).map((v, k) => [STAT[k], v]));
  const vg = Object.fromEntries(dominant(visualGroups).map((v, k) => [VIS[k], v]));
  const gender = GENDER[vg.gender] || 'unknown';
  const firstList = gender === 'female' ? femaleNames : maleNames;
  const name = `${firstList[i.firstName] ?? '#' + i.firstName} ${lastNames[i.lastName] ?? ''}`.trim();
  const transcendedTimestamp = meta.ts ?? null;

  return {
    heroId: h.id.toString(),
    chain,
    transcendedOwner: meta.owner ?? null,
    transcendedBlock: meta.block ?? null,
    transcendedTimestamp,
    transcendedDate: transcendedTimestamp ? new Date(transcendedTimestamp * 1000).toISOString() : null,
    name,
    firstNameId: i.firstName,
    lastNameId: i.lastName,
    mainClass: CLASSES[i.class] ?? `class${i.class}`,
    mainClassId: i.class,
    subClass: CLASSES[i.subClass] ?? `class${i.subClass}`,
    subClassId: i.subClass,
    rarity: RARITIES[i.rarity] ?? `rarity${i.rarity}`,
    rarityId: i.rarity,
    generation: i.generation,
    shiny: i.shiny,
    shinyStyle: i.shinyStyle,
    level: st.level,
    xp: st.xp.toString(),
    sp: st.sp,
    status: st.status,
    statusId: st.status,
    element: ELEMENT[sg.element] ?? `element${sg.element}`,
    elementId: sg.element,
    profession: PROFESSION[sg.profession] ?? `profession${sg.profession}`,
    professionId: sg.profession,
    statGeneMainClass: mapStatGene('mainClass', sg.mainClass),
    statGeneMainClassRaw: sg.mainClass,
    statGeneSubClass: mapStatGene('subClass', sg.subClass),
    statGeneSubClassRaw: sg.subClass,
    statGeneProfession: mapStatGene('profession', sg.profession),
    statGeneProfessionRaw: sg.profession,
    statGeneElement: mapStatGene('element', sg.element),
    statGeneElementRaw: sg.element,
    statBoost1: STAT_BOOST[sg.statBoost1] ?? `boost${sg.statBoost1}`,
    statBoost1Id: sg.statBoost1,
    statBoost2: STAT_BOOST[sg.statBoost2] ?? `boost${sg.statBoost2}`,
    statBoost2Id: sg.statBoost2,
    active1: ACTIVE[sg.active1] ?? `active${sg.active1}`,
    active1Id: sg.active1,
    active2: ACTIVE[sg.active2] ?? `active${sg.active2}`,
    active2Id: sg.active2,
    passive1: PASSIVE[sg.passive1] ?? `passive${sg.passive1}`,
    passive1Id: sg.passive1,
    passive2: PASSIVE[sg.passive2] ?? `passive${sg.passive2}`,
    passive2Id: sg.passive2,
    crafting1: CRAFTING[sg.crafting1] ?? `crafting${sg.crafting1}`,
    crafting1Raw: sg.crafting1,
    crafting2: CRAFTING[sg.crafting2] ?? `crafting${sg.crafting2}`,
    crafting2Raw: sg.crafting2,
    gender,
    background: BACKGROUND[vg.background] ?? `bg${vg.background}`,
    hairStyle: vg.hairStyle,
    hairColor: vg.hairColor,
    eyeColor: vg.eyeColor,
    skinColor: vg.skinColor,
    headAppendage: vg.headAppendage,
    backAppendage: vg.backAppendage,
    appendageColor: vg.appendageColor,
    backAppendageColor: vg.backAppendageColor,
    visualUnknown1: vg.visualUnknown1,
    visualUnknown2: vg.visualUnknown2,
    summonedTime: su.summonedTime.toString(),
    nextSummonTime: su.nextSummonTime.toString(),
    summonerId: su.summonerId.toString(),
    assistantId: su.assistantId.toString(),
    summons: su.summons,
    maxSummons: su.maxSummons,
    summonsRemaining: Math.max(0, su.maxSummons - su.summons),
    strength: s.strength, intelligence: s.intelligence, wisdom: s.wisdom, luck: s.luck,
    agility: s.agility, vitality: s.vitality, endurance: s.endurance, dexterity: s.dexterity,
    hp: s.hp, mp: s.mp, stamina: s.stamina,
    mining: p.mining,
    gardening: p.gardening,
    foraging: p.foraging,
    fishing: p.fishing,
    craft1: p.craft1 ?? 0,
    craft2: p.craft2 ?? 0,
    miningSkill: p.mining / 10,
    gardeningSkill: p.gardening / 10,
    foragingSkill: p.foraging / 10,
    fishingSkill: p.fishing / 10,
    craft1Skill: (p.craft1 ?? 0) / 10,
    craft2Skill: (p.craft2 ?? 0) / 10,
    ...growthFields(h.primaryStatGrowth, 'primary'),
    ...growthFields(h.secondaryStatGrowth, 'secondary'),
    ...geneFields(statGroups, STAT, 'statGene', mapStatGene),
    ...geneFields(visualGroups, VIS, 'visualGene', mapVisualGene),
    // raw genes preserved for any further decode.
    statGenes: i.statGenes.toString(),
    visualGenes: i.visualGenes.toString(),
  };
}
