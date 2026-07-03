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

// ---- Scryfall caching proxy ----
const SCRY_UPSTREAM = process.env.SCRY_UPSTREAM ?? 'https://api.scryfall.com'
const SCRY_PREFIX = '/scryfall-api'
const SCRY_UA = 'GalaxyCommander/1.0 (+https://commander.thegalaxy.dev)'
const SCRY_FRESH_MS = process.env.SCRY_FRESH_MS
  ? Number(process.env.SCRY_FRESH_MS)
  : 12 * 60 * 60 * 1000 // serve cache without hitting upstream for 12h
const SCRY_TIMEOUT_MS = 9000
const SCRY_THROTTLE_MS = 80 // min gap between upstream calls (Scryfall asks ~50-100ms)
const SCRY_MAX_BODY = 2 * 1024 * 1024 // skip caching responses larger than 2MB
const SCRY_MAX_ROWS = 20000
const SCRY_CACHE_METHODS = new Set(['GET', 'POST'])

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
  CREATE TABLE IF NOT EXISTS scryfall_cache (
    key     TEXT PRIMARY KEY,
    status  INTEGER NOT NULL,
    ctype   TEXT NOT NULL,
    body    BLOB NOT NULL,
    fetched INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scry_fetched ON scryfall_cache(fetched);
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

// ---------- Scryfall cache statements + proxy ----------
const stmtScryGet = db.prepare('SELECT status, ctype, body, fetched FROM scryfall_cache WHERE key = ?')
const stmtScryPut = db.prepare(
  'INSERT INTO scryfall_cache (key, status, ctype, body, fetched) VALUES (@key, @status, @ctype, @body, @fetched) ' +
    'ON CONFLICT(key) DO UPDATE SET status=@status, ctype=@ctype, body=@body, fetched=@fetched',
)
const stmtScryCount = db.prepare('SELECT COUNT(*) AS n FROM scryfall_cache')
const stmtScryEvict = db.prepare(
  'DELETE FROM scryfall_cache WHERE key IN (SELECT key FROM scryfall_cache ORDER BY fetched ASC LIMIT ?)',
)

function scryCacheKey(method, pathQuery, bodyText) {
  if (method === 'POST') {
    const h = createHash('sha256').update(bodyText ?? '').digest('hex').slice(0, 24)
    return `POST ${pathQuery} ${h}`
  }
  return `GET ${pathQuery}`
}

function scryGetCached(key) {
  const row = stmtScryGet.get(key)
  if (!row) return null
  return { status: row.status, ctype: row.ctype, body: row.body, fetched: row.fetched }
}

function scryPutCached(key, status, ctype, body) {
  if (body.length > SCRY_MAX_BODY) return
  stmtScryPut.run({ key, status, ctype, body, fetched: Date.now() })
  if (stmtScryCount.get().n > SCRY_MAX_ROWS) stmtScryEvict.run(Math.ceil(SCRY_MAX_ROWS * 0.1))
}

// ---------- MTGJSON offline fallback ----------
// A locally-built card database (see build-mtgjson.mjs) used to synthesize
// Scryfall-compatible responses for name lookups when Scryfall is unavailable.
const MTGJSON_DB_PATH = path.join(DATA_DIR, 'mtgjson.db')
let mtgDb = null
let stmtMtgExact = null
let stmtMtgLike = null
function openMtgDb() {
  if (mtgDb || !existsSync(MTGJSON_DB_PATH)) return
  try {
    mtgDb = new Database(MTGJSON_DB_PATH, { readonly: true, fileMustExist: true })
    stmtMtgExact = mtgDb.prepare('SELECT data FROM cards WHERE name_lower = ?')
    stmtMtgLike = mtgDb.prepare('SELECT data FROM cards WHERE name_lower LIKE ? ORDER BY length(name_lower) ASC LIMIT 1')
  } catch {
    mtgDb = null
  }
}
openMtgDb()

function mtgExact(name) {
  if (!stmtMtgExact) return null
  const row = stmtMtgExact.get(String(name).toLowerCase())
  return row ? JSON.parse(row.data) : null
}

function mtgFuzzy(name) {
  const exact = mtgExact(name)
  if (exact) return exact
  if (!stmtMtgLike) return null
  const q = String(name).toLowerCase().replace(/[%_]/g, '')
  for (const pat of [`${q}%`, `%${q}%`]) {
    const row = stmtMtgLike.get(pat)
    if (row) return JSON.parse(row.data)
  }
  return null
}

function jsonBody(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8')
}

// Returns { status, ctype, body } synthesized from MTGJSON, or null if the
// endpoint is not name-resolvable (e.g. search) or the db isn't available.
function mtgjsonFallback(method, pathQuery, bodyText) {
  openMtgDb()
  if (!mtgDb) return null
  const ctype = 'application/json; charset=utf-8'

  if (method === 'POST' && pathQuery.startsWith('/cards/collection')) {
    let ids = []
    try {
      ids = JSON.parse(bodyText ?? '{}')?.identifiers ?? []
    } catch {
      return null
    }
    const data = []
    const not_found = []
    for (const id of ids) {
      const card = id?.name ? mtgExact(id.name) : null
      if (card) data.push(card)
      else not_found.push(id)
    }
    return { status: 200, ctype, body: jsonBody({ object: 'list', has_more: false, data, not_found }) }
  }

  if (method === 'GET' && pathQuery.startsWith('/cards/named')) {
    const qs = new URLSearchParams(pathQuery.split('?')[1] ?? '')
    const exact = qs.get('exact')
    const fuzzy = qs.get('fuzzy')
    const card = exact ? mtgExact(exact) : fuzzy ? mtgFuzzy(fuzzy) : null
    if (card) return { status: 200, ctype, body: jsonBody(card) }
    return {
      status: 404,
      ctype,
      body: jsonBody({ object: 'error', code: 'not_found', details: 'Card not found (offline fallback).' }),
    }
  }

  return null
}

// Serialize upstream calls with a small throttle to respect Scryfall's rate guidance.
let scryChain = Promise.resolve()
function scrySchedule(fn) {
  const run = scryChain.then(async () => {
    try {
      return await fn()
    } finally {
      await new Promise((r) => setTimeout(r, SCRY_THROTTLE_MS))
    }
  })
  scryChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function scryUpstream(method, pathQuery, bodyText) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SCRY_TIMEOUT_MS)
  try {
    const res = await fetch(`${SCRY_UPSTREAM}${pathQuery}`, {
      method,
      signal: ctrl.signal,
      headers: {
        'User-Agent': SCRY_UA,
        Accept: method === 'POST' ? 'application/json' : '*/*',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? bodyText : undefined,
    })
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, ctype: res.headers.get('content-type') ?? 'application/json', body: buf }
  } finally {
    clearTimeout(timer)
  }
}

async function handleScryfall(req, res) {
  const method = req.method ?? 'GET'
  if (!SCRY_CACHE_METHODS.has(method)) return sendJson(res, 405, { error: 'Method not allowed.' })

  const pathQuery = req.url.slice(SCRY_PREFIX.length) || '/'
  let bodyText
  if (method === 'POST') {
    try {
      bodyText = await readBody(req)
    } catch {
      return sendJson(res, 413, { error: 'Payload too large.' })
    }
  }

  const key = scryCacheKey(method, pathQuery, bodyText)
  const cached = scryGetCached(key)
  const now = Date.now()

  const respond = (status, ctype, body, cacheState) => {
    res.writeHead(status, {
      'Content-Type': ctype,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Proxy-Cache': cacheState,
    })
    res.end(body)
  }

  // /cards/random must never be cached — caching it returns the same "random"
  // card on every call. Always proxy fresh upstream and skip the cache layer.
  if (pathQuery.startsWith('/cards/random')) {
    try {
      const up = await scrySchedule(() => scryUpstream(method, pathQuery, bodyText))
      return respond(up.status, up.ctype, up.body, 'bypass')
    } catch {
      return sendJson(res, 503, { error: 'Scryfall is unavailable.' })
    }
  }

  // fresh cache hit: skip upstream entirely
  if (cached && now - cached.fetched < SCRY_FRESH_MS) {
    return respond(cached.status, cached.ctype, cached.body, 'fresh')
  }

  try {
    const up = await scrySchedule(() => scryUpstream(method, pathQuery, bodyText))
    // cache successful + definitive-not-found responses
    if (up.status === 200 || up.status === 404) scryPutCached(key, up.status, up.ctype, up.body)
    // upstream is unhealthy (5xx/429): prefer stale cache, then MTGJSON fallback
    if (up.status >= 500 || up.status === 429) {
      if (cached) return respond(cached.status, cached.ctype, cached.body, 'stale')
      const mj = mtgjsonFallback(method, pathQuery, bodyText)
      if (mj) return respond(mj.status, mj.ctype, mj.body, 'mtgjson')
    }
    return respond(up.status, up.ctype, up.body, cached ? 'revalidated' : 'miss')
  } catch {
    // network error / timeout -> stale-if-error, then MTGJSON fallback
    if (cached) return respond(cached.status, cached.ctype, cached.body, 'stale')
    const mj = mtgjsonFallback(method, pathQuery, bodyText)
    if (mj) return respond(mj.status, mj.ctype, mj.body, 'mtgjson')
    return sendJson(res, 503, { error: 'Scryfall is unavailable and no cached copy exists yet.' })
  }
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

    if (pathname === SCRY_PREFIX || pathname.startsWith(`${SCRY_PREFIX}/`)) {
      return await handleScryfall(req, res)
    }

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
