# DFK Classic: Transcended Hero Roster

Every DeFi Kingdoms hero permanently burned through Divine Transcendence,
indexed from chain. This is the collectible pool for DFK Classic.

## The numbers

| Chain | Unique transcended heroes |
|---|---|
| DFK Chain (Crystalvale) | 146,791 |
| Kaia (Serendale) | 24,038 |
| Total (deduped, zero overlap) | **170,829** |

Indexed from `HeroTranscended` events emitted by the HeroCore diamond on each
chain. First transcend: 2025-05-29 (Divine Altar launch). Last indexed:
2026-03-22 (game feature pause). Around 63k heroes transcended in the first
two months, and another 25k in March 2026 ahead of the pause.

## Files

- `data/transcended-roster.csv`: one row per hero (`heroId, chain, block, transcendedDate`)
- `data/transcended-roster.xlsx`: same data, Excel-friendly (heroId stored as text)
- `data/raw/transcended-dfkchain.json`: raw DFK Chain events (heroId, owner, block, timestamp)
- `data/raw/transcended-kaia.json`: raw Kaia events

## Full hero metadata

Every card attribute for all 170,829 heroes, decoded from chain: class,
subClass, rarity, generation, level, xp, stats, growth, element, profession
and skill levels, crafting, active and passive abilities by name, the full
recessive genes (R1/R2/R3, stat and visual), plus the wallet that transcended
the hero with block and date. 335 columns.

The full JSON and CSV are published under
[Releases](https://github.com/dfk-classic/transcended-roster/releases) (too
large for git). A 40-hero sample lives at `data/hero-metadata-sample20.json`
and `.csv`.

Rebuild or check it yourself:

```bash
node scripts/export-metadata.mjs              # full export, resumable, ~1h
node scripts/export-metadata.mjs --sample 20  # quick preview
node scripts/verify-decode.mjs data/hero-metadata.json   # re-derive every gene field and compare
```

Trait order, slot order (r3 r2 r1 dominant per 4-gene group) and all enum
names follow the documented gene encoding and match HONK Marketplace's
mappings. `lib/decode.mjs` also exports `translateGenes(statGenes, visualGenes)`
if you want the decoder without the exporter.

## Reproduce it yourself

You don't have to trust this repo. All of it is rebuilt from public chain
data, no API keys needed.

```bash
npm install
node scripts/index-dfkchain.mjs   # ~10 min, via Routescan public API
node scripts/index-kaia.mjs       # ~2 min, via DFK's public Kaia RPC
node scripts/build-roster.mjs     # dedupe + export csv/xlsx
node scripts/fetch-hero.mjs 1000000722356   # spot-check any hero's full record
```

Requires Node 18+.

## How it works

- The `HeroTranscended` event (topic0
  `0xe0b50343ad292b1895adf59cc0a6dbffbcee0ba29a81edc4b9794a0acec9bd93`) is
  emitted by `completeTranscend()` on the HeroCore diamond. heroId and owner
  are indexed topics, Divine Essence amounts are in the data.
- HeroCore is `0xEb9B61B145D6489Be575D3603F4a704810e143dF` on DFK Chain (53935)
  and `0x268CC8248FFB72Cd5F3e73A9a20Fa2FF40EfbA61` on Kaia (8217).
- `getHero(heroId)` on the same contracts returns the full hero record: class,
  subClass, rarity, generation, stats, stat growth, professions, names, and
  the stat/visual genes. View functions keep working while the game is paused.
- 11 hero IDs on DFK Chain emitted duplicate events (same-day double emits).
  The roster counts unique heroes only. The two chains have zero ID overlap.

## Notes

- Kaia rows have no `transcendedDate` since raw `eth_getLogs` has no
  timestamps. Block numbers are exact and dates can be derived from them.
- Hero IDs are uint256. Treat them as text in spreadsheets, otherwise Excel
  mangles them into scientific notation.
