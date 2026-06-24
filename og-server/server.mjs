import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import LZString from 'lz-string'
import Database from 'better-sqlite3'

const PORT = process.env.OG_PORT ? Number(process.env.OG_PORT) : 8787
const INDEX_PATH = process.env.OG_INDEX ?? '/var/www/commander.thegalaxy.dev/index.html'
const DATA_DIR = process.env.OG_DATA ?? path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'shares.db')
const LEGACY_JSON_PATH = path.join(DATA_DIR, 'shares.json')
const ORIGIN = 'https://commander.thegalaxy.dev'

const SCRY_TTL_MS = 24 * 60 * 60 * 1000
const SHARE_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days, refreshed on access
const MAX_PARAM_LEN = 16000 // compressed payload chars
const MAX_CARD_ENTRIES = 300
const MAX_STORE = 100000
const RATE_LIMIT = 40 // share-link creates per window per IP
const GEN_RATE_LIMIT = 240 // generation pings per window per IP
const RATE_WINDOW_MS = 60 * 60 * 1000
const MAX_BODY = 32 * 1024

const scryCache = new Map() // name -> { at, data }

// ---------- datastore (SQLite) ----------
mkdirSync(DATA_DIR, { recursive: true })
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id      TEXT PRIMARY KEY,
    hash    TEXT NOT NULL UNIQUE,
    d       TEXT NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    hits    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires);
  CREATE TABLE IF NOT EXISTS counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO counters (name, value) VALUES ('decks_generated', 0);
`)

const stmtByHash = db.prepare('SELECT id, expires FROM shares WHERE hash = ?')
const stmtById = db.prepare('SELECT id, d, hash, created, expires, hits FROM shares WHERE id = ?')
const stmtIdExists = db.prepare('SELECT 1 FROM shares WHERE id = ?')
const stmtInsert = db.prepare(
  'INSERT INTO shares (id, hash, d, created, expires, hits) VALUES (?, ?, ?, ?, ?, 0)',
)
const stmtTouch = db.prepare('UPDATE shares SET expires = ?, hits = hits + 1 WHERE id = ?')
const stmtRenew = db.prepare('UPDATE shares SET expires = ? WHERE id = ?')
const stmtDelete = db.prepare('DELETE FROM shares WHERE id = ?')
const stmtDeleteExpired = db.prepare('DELETE FROM shares WHERE expires <= ?')
const stmtCount = db.prepare('SELECT COUNT(*) AS n FROM shares')
const stmtBumpCounter = db.prepare(
  'UPDATE counters SET value = value + ? WHERE name = ? RETURNING value',
)
const stmtGetCounter = db.prepare('SELECT value FROM counters WHERE name = ?')

function bumpGenerated(by = 1) {
  const n = Math.max(1, Math.min(50, Math.floor(Number(by) || 1)))
  const row = stmtBumpCounter.get(n, 'decks_generated')
  return row?.value ?? 0
}

function generatedCount() {
  return stmtGetCounter.get('decks_generated')?.value ?? 0
}

function cleanupExpired() {
  stmtDeleteExpired.run(Date.now())
}

function newId() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = randomBytes(6).toString('base64url').slice(0, 8)
    if (!stmtIdExists.get(id)) return id
  }
  return randomBytes(12).toString('base64url').slice(0, 12)
}

// One-time migration from the legacy file-based JSON store.
function migrateLegacyStore() {
  if (!existsSync(LEGACY_JSON_PATH)) return
  try {
    const legacy = JSON.parse(readFileSync(LEGACY_JSON_PATH, 'utf8'))
    const byId = legacy?.byId ?? {}
    const insertMany = db.transaction((rows) => {
      for (const [id, rec] of rows) {
        if (!rec?.d || !rec?.hash) continue
        try {
          stmtInsert.run(id, rec.hash, rec.d, rec.created ?? Date.now(), rec.expires ?? Date.now() + SHARE_TTL_MS)
          if (rec.hits) db.prepare('UPDATE shares SET hits = ? WHERE id = ?').run(rec.hits, id)
        } catch {
          // skip duplicates / bad rows
        }
      }
    })
    insertMany(Object.entries(byId))
    renameSync(LEGACY_JSON_PATH, `${LEGACY_JSON_PATH}.migrated`)
    console.log(`migrated ${Object.keys(byId).length} legacy share(s) into SQLite`)
  } catch (err) {
    console.error('legacy migration failed:', err?.message)
  }
}

// ---------- deck decoding ----------
function decodeRaw(param) {
  try {
    const json = LZString.decompressFromEncodedURIComponent(param)
    if (!json) return null
    const data = JSON.parse(json)
    const cmd = (data.cmd ?? []).filter((p) => Array.isArray(p) && typeof p[0] === 'string')
    const cards = (data.cards ?? []).filter((p) => Array.isArray(p) && typeof p[0] === 'string')
    if (!cmd.length && !cards.length) return null
    return {
      fmt: typeof data.fmt === 'string' ? data.fmt : 'commander',
      name: typeof data.n === 'string' ? data.n.trim() : '',
      cmd,
      cards,
    }
  } catch {
    return null
  }
}

function canonicalHash(deck) {
  const norm = (pairs) =>
    pairs
      .map((p) => [String(p[0]), Number(p[1]) > 0 ? Number(p[1]) : 1])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const canon = JSON.stringify({
    fmt: deck.fmt,
    n: deck.name,
    cmd: norm(deck.cmd),
    cards: norm(deck.cards),
  })
  return createHash('sha256').update(canon).digest('hex')
}

function deckMeta(deck) {
  const commanders = deck.cmd.map((p) => p[0])
  const cardCount =
    deck.cards.reduce((n, p) => n + (Number(p[1]) > 0 ? Number(p[1]) : 1), 0) + commanders.length
  return { commanders, cardCount, name: deck.name }
}

// ---------- scryfall ----------
async function resolveCommander(name) {
  const hit = scryCache.get(name)
  if (hit && Date.now() - hit.at < SCRY_TTL_MS) return hit.data
  let data = null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'GalaxyCommander/1.0' },
    })
    clearTimeout(timer)
    if (res.ok) {
      const card = await res.json()
      const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris
      data = { image: uris?.large ?? uris?.normal ?? null, colors: card.color_identity ?? [] }
    }
  } catch {
    data = null
  }
  scryCache.set(name, { at: Date.now(), data })
  return data
}

const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }
const colorText = (colors) =>
  !colors?.length ? 'Colorless' : colors.map((c) => COLOR_NAMES[c] ?? c).join('/')

// ---------- HTML / OG ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const OG_BLOCK_RE = /<!-- OG:START -->[\s\S]*?<!-- OG:END -->/

function buildOgBlock({ title, description, image, url }) {
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  const img = escapeHtml(image)
  const u = escapeHtml(url)
  return `<!-- OG:START -->
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Galaxy Commander" />
    <meta property="og:url" content="${u}" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:image" content="${img}" />
    <meta property="og:image:alt" content="${t}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${img}" />
    <!-- OG:END -->`
}

function injectClientDeck(html, param, missing) {
  let script = ''
  if (param) script = `<script>window.__SHARED_DECK__=${JSON.stringify(param)};</script>`
  else if (missing) script = `<script>window.__SHARE_MISSING__=true;</script>`
  if (!script) return html
  return html.replace('</head>', `    ${script}\n  </head>`)
}

async function renderDeckPage(param, canonicalUrl) {
  const html = await readFile(INDEX_PATH, 'utf8')
  const deck = param ? decodeRaw(param) : null
  if (!deck || !deck.cmd.length) {
    return injectClientDeck(html, param, !param)
  }
  const meta = deckMeta(deck)
  const lead = meta.commanders.join(' + ')
  const card = await resolveCommander(meta.commanders[0])
  const title = meta.name ? `${meta.name} — Commander Deck` : `${lead} — Commander Deck`
  const colorBit = card ? `${colorText(card.colors)} ` : ''
  const description = `${colorBit}Commander deck led by ${lead} — ${meta.cardCount} cards. Open in Galaxy Commander to view, tune, and export.`
  const image = card?.image ?? `${ORIGIN}/icon.png`
  const withOg = html.replace(OG_BLOCK_RE, buildOgBlock({ title, description, image, url: canonicalUrl }))
  return injectClientDeck(withOg, param, false)
}

// ---------- rate limiting ----------
const rate = new Map() // key -> number[] timestamps
function rateLimited(key, limit = RATE_LIMIT) {
  const now = Date.now()
  const arr = (rate.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (arr.length >= limit) {
    rate.set(key, arr)
    return true
  }
  arr.push(now)
  rate.set(key, arr)
  return false
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

// ---------- create / fetch ----------
async function handleCreate(req, res) {
  const ip = clientIp(req)
  if (rateLimited(ip)) return sendJson(res, 429, { error: 'Too many links created. Try again later.' })
  let body
  try {
    body = await readBody(req)
  } catch {
    return sendJson(res, 413, { error: 'Payload too large.' })
  }
  let param
  try {
    param = JSON.parse(body)?.d
  } catch {
    return sendJson(res, 400, { error: 'Invalid request.' })
  }
  if (typeof param !== 'string' || !param.length) return sendJson(res, 400, { error: 'Missing deck data.' })
  if (param.length > MAX_PARAM_LEN) return sendJson(res, 413, { error: 'Deck is too large for a permanent link.' })
  const deck = decodeRaw(param)
  if (!deck || !deck.cards.length) return sendJson(res, 400, { error: 'Could not read that deck.' })
  if (deck.cards.length + deck.cmd.length > MAX_CARD_ENTRIES)
    return sendJson(res, 413, { error: 'Deck has too many entries.' })

  const hash = canonicalHash(deck)
  const now = Date.now()
  const existing = stmtByHash.get(hash)
  if (existing) {
    stmtRenew.run(now + SHARE_TTL_MS, existing.id)
    return sendJson(res, 200, { id: existing.id, url: `${ORIGIN}/d/${existing.id}`, deduped: true })
  }

  if (stmtCount.get().n >= MAX_STORE) {
    cleanupExpired()
    if (stmtCount.get().n >= MAX_STORE)
      return sendJson(res, 503, { error: 'Link storage is full. Try again later.' })
  }

  const id = newId()
  stmtInsert.run(id, hash, param, now, now + SHARE_TTL_MS)
  return sendJson(res, 201, { id, url: `${ORIGIN}/d/${id}` })
}

function getRecord(id) {
  const rec = stmtById.get(id)
  if (!rec) return null
  if (rec.expires <= Date.now()) {
    stmtDelete.run(id)
    return null
  }
  // sliding expiration: keep popular links alive
  stmtTouch.run(Date.now() + SHARE_TTL_MS, id)
  return rec
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN)
    const { pathname } = url

    if (pathname === '/api/share' && req.method === 'POST') return await handleCreate(req, res)

    if (pathname === '/api/stats' && req.method === 'GET') {
      return sendJson(res, 200, { decksGenerated: generatedCount() })
    }

    if (pathname === '/api/generated' && req.method === 'POST') {
      if (rateLimited(`gen:${clientIp(req)}`, GEN_RATE_LIMIT))
        return sendJson(res, 429, { error: 'Too many requests.' })
      return sendJson(res, 200, { decksGenerated: bumpGenerated(1) })
    }

    const apiGet = pathname.match(/^\/api\/share\/([A-Za-z0-9_-]{4,16})$/)
    if (apiGet && req.method === 'GET') {
      const rec = getRecord(apiGet[1])
      if (!rec) return sendJson(res, 404, { error: 'Not found or expired.' })
      return sendJson(res, 200, { d: rec.d })
    }

    const dPath = pathname.match(/^\/d\/([A-Za-z0-9_-]{4,16})$/)
    if (dPath && req.method === 'GET') {
      const rec = getRecord(dPath[1])
      const html = await renderDeckPage(rec?.d ?? null, `${ORIGIN}/d/${dPath[1]}`)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
      return res.end(html)
    }

    // /deck?d=... (compressed URL share)
    if (pathname === '/deck') {
      const param = url.searchParams.get('d')
      const html = await renderDeckPage(param, `${ORIGIN}/deck${url.search}`)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
      return res.end(html)
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal error')
  }
})

migrateLegacyStore()
cleanupExpired()
setInterval(cleanupExpired, 60 * 60 * 1000).unref()

function shutdown() {
  try {
    db.close()
  } catch {
    // ignore
  }
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.listen(PORT, '127.0.0.1', () => {
  console.log(`OG/share server listening on 127.0.0.1:${PORT}`)
})
