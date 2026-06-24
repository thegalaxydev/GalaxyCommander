// Builds a local card database from MTGJSON's AtomicCards file, used as an
// offline fallback for the Scryfall proxy when Scryfall is unavailable.
// Each card is stored pre-shaped to look like a Scryfall card object so the
// proxy can synthesize Scryfall-compatible responses with no transform at read
// time. Run via: node --max-old-space-size=3072 build-mtgjson.mjs
import { gunzipSync } from 'node:zlib'
import { mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const DATA_DIR = process.env.OG_DATA ?? path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'mtgjson.db')
const TMP_PATH = `${DB_PATH}.building`
const SOURCE = process.env.MTGJSON_URL ?? 'https://mtgjson.com/api/v5/AtomicCards.json.gz'

function lcLegalities(legalities) {
  const out = {}
  for (const [k, v] of Object.entries(legalities ?? {})) out[k] = String(v).toLowerCase()
  return out
}

// Combine MTGJSON atomic entries (one per face) into a Scryfall-shaped card.
function synthesize(entries) {
  const a = entries[0]
  const card = {
    id: a.identifiers?.scryfallId ?? a.identifiers?.scryfallOracleId ?? a.uuid ?? a.name,
    oracle_id: a.identifiers?.scryfallOracleId ?? '',
    name: a.name,
    layout: a.layout ?? 'normal',
    mana_cost: a.manaCost ?? '',
    cmc: typeof a.manaValue === 'number' ? a.manaValue : 0,
    type_line: a.type ?? '',
    oracle_text: a.text ?? '',
    colors: a.colors ?? [],
    color_identity: a.colorIdentity ?? [],
    keywords: a.keywords ?? [],
    legalities: lcLegalities(a.legalities),
    prices: { usd: null },
    game_changer: false,
    _mtgjson: true,
  }
  if (typeof a.edhrecRank === 'number') card.edhrec_rank = a.edhrecRank
  if (entries.length > 1) {
    card.card_faces = entries.map((f) => ({
      name: f.faceName ?? f.name,
      mana_cost: f.manaCost ?? '',
      type_line: f.type ?? '',
      oracle_text: f.text ?? '',
    }))
  }
  return card
}

async function main() {
  console.log(`[mtgjson] downloading ${SOURCE} ...`)
  const res = await fetch(SOURCE, { headers: { 'User-Agent': 'GalaxyCommander/1.0' } })
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const gz = Buffer.from(await res.arrayBuffer())
  console.log(`[mtgjson] downloaded ${(gz.length / 1048576).toFixed(1)} MB, decompressing ...`)
  const json = gunzipSync(gz).toString('utf8')
  const parsed = JSON.parse(json)
  const data = parsed?.data ?? {}
  const names = Object.keys(data)
  console.log(`[mtgjson] parsed ${names.length} card names, writing db ...`)

  mkdirSync(DATA_DIR, { recursive: true })
  const db = new Database(TMP_PATH)
  db.exec(`
    DROP TABLE IF EXISTS cards;
    CREATE TABLE cards (
      name_lower TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      data       TEXT NOT NULL
    );
  `)
  const insert = db.prepare('INSERT OR IGNORE INTO cards (name_lower, name, data) VALUES (?, ?, ?)')

  const writeAll = db.transaction(() => {
    // Insert full names first so they win over any face-name alias collisions.
    for (const name of names) {
      const entries = data[name]
      if (!Array.isArray(entries) || !entries.length) continue
      const card = synthesize(entries)
      const payload = JSON.stringify(card)
      insert.run(name.toLowerCase(), card.name, payload)
    }
    // Then alias each face name (e.g. "Pinnacle Monk" -> the full DFC) so lookups
    // by a single face still resolve.
    for (const name of names) {
      const entries = data[name]
      if (!Array.isArray(entries) || entries.length < 2) continue
      const card = synthesize(entries)
      const payload = JSON.stringify(card)
      for (const f of entries) {
        const fn = f.faceName ?? f.name
        if (fn) insert.run(String(fn).toLowerCase(), card.name, payload)
      }
    }
  })
  writeAll()

  const count = db.prepare('SELECT COUNT(*) AS n FROM cards').get().n
  db.close()
  renameSync(TMP_PATH, DB_PATH)
  console.log(`[mtgjson] done: ${count} lookup keys -> ${DB_PATH}`)
}

main().catch((err) => {
  console.error('[mtgjson] build failed:', err)
  process.exit(1)
})
