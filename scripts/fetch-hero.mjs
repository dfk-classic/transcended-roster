// Spot-check any hero's full on-chain record: node scripts/fetch-hero.mjs <heroId>
// View functions work even while the game is paused.
import { createPublicClient, http } from 'viem';
import { readFileSync } from 'node:fs';

const heroId = process.argv[2];
if (!heroId) { console.error('usage: node scripts/fetch-hero.mjs <heroId>'); process.exit(1); }

const HEROCORE = '0xEb9B61B145D6489Be575D3603F4a704810e143dF';
const abi = JSON.parse(readFileSync(new URL('../abi/HeroCoreDiamond.json', import.meta.url)));

const CLASSES = { 0: 'Warrior', 1: 'Knight', 2: 'Thief', 3: 'Archer', 4: 'Priest', 5: 'Wizard',
  6: 'Monk', 7: 'Pirate', 8: 'Berserker', 9: 'Seer', 10: 'Legionnaire', 11: 'Scholar',
  16: 'Paladin', 17: 'DarkKnight', 18: 'Summoner', 19: 'Ninja', 20: 'Shapeshifter',
  21: 'Bard', 24: 'Dragoon', 25: 'Sage', 26: 'SpellBow', 28: 'DreadKnight' };
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Mythic'];

const client = createPublicClient({
  chain: { id: 53935, name: 'DFK Chain', nativeCurrency: { name: 'JEWEL', symbol: 'JEWEL', decimals: 18 },
           rpcUrls: { default: { http: ['https://subnets.avax.network/defi-kingdoms/dfk-chain/rpc'] } } },
  transport: http(),
});

const h = await client.readContract({ address: HEROCORE, abi: Array.isArray(abi) ? abi : abi.abi, functionName: 'getHero', args: [BigInt(heroId)] });
console.log(`hero ${heroId}`);
console.log(`  class      : ${CLASSES[h.info.class] ?? h.info.class} / ${CLASSES[h.info.subClass] ?? h.info.subClass}`);
console.log(`  rarity     : ${RARITIES[h.info.rarity]}  gen ${h.info.generation}  ${h.info.shiny ? 'SHINY' : ''}`);
console.log(`  level      : ${h.state.level}  xp ${h.state.xp}`);
console.log(`  stats      : STR ${h.stats.strength} AGI ${h.stats.agility} INT ${h.stats.intelligence} WIS ${h.stats.wisdom} VIT ${h.stats.vitality} END ${h.stats.endurance} DEX ${h.stats.dexterity} LCK ${h.stats.luck}`);
console.log(`  hp/mp/stam : ${h.stats.hp} / ${h.stats.mp} / ${h.stats.stamina}`);
console.log(`  summons    : ${h.summoningInfo.summons}/${h.summoningInfo.maxSummons}`);
console.log(`  professions: mining ${h.professions.mining} gardening ${h.professions.gardening} foraging ${h.professions.foraging} fishing ${h.professions.fishing}`);
console.log(`  statGenes  : ${h.info.statGenes}`);
console.log(`  visualGenes: ${h.info.visualGenes}`);
