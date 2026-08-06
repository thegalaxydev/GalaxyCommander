import { eq } from 'drizzle-orm'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { auth } from '../auth.js'
import { db } from '../db/index.js'
import { userData } from '../db/schema.js'
import { hasProfanity } from '../profanity.js'

/** Returns the name of a public deck with disallowed language, or null. Private
 *  decks are owner-only and never blocked, so sync of pack data never breaks. */
function offendingPublicDeckName(decks: unknown): string | null {
  if (!Array.isArray(decks)) return null
  for (const d of decks as { name?: unknown; public?: unknown }[]) {
    if (d?.public && typeof d.name === 'string' && hasProfanity(d.name)) return d.name
  }
  return null
}

export type UserDataPayload = {
  savedDecks?: unknown
  packCollection?: unknown
  packCardMeta?: unknown
  packStats?: unknown
  packSessions?: unknown
  packAchievements?: unknown
  settings?: unknown
}

const DEFAULTS = {
  savedDecks: [],
  packCollection: {},
  packCardMeta: {},
  packStats: {},
  packSessions: [],
  packAchievements: {},
  settings: null,
}

async function readBody(req: IncomingMessage, max = 2_000_000): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > max) throw new Error('Payload too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export async function getSession(req: IncomingMessage) {
  return auth.api.getSession({ headers: req.headers as HeadersInit })
}

export async function requireUser(req: IncomingMessage, res: ServerResponse) {
  const session = await getSession(req)
  if (!session?.user) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return null
  }
  return session
}

export async function ensureUserDataRow(userId: string) {
  const existing = await db.select().from(userData).where(eq(userData.userId, userId)).limit(1)
  if (existing.length) return existing[0]
  const [row] = await db
    .insert(userData)
    .values({ userId, ...DEFAULTS })
    .returning()
  return row
}

export async function handleUserData(req: IncomingMessage, res: ServerResponse) {
  const session = await requireUser(req, res)
  if (!session) return

  const userId = session.user.id

  if (req.method === 'GET') {
    const row = await ensureUserDataRow(userId)
    sendJson(res, 200, {
      savedDecks: row.savedDecks,
      packCollection: row.packCollection,
      packCardMeta: row.packCardMeta,
      packStats: row.packStats,
      packSessions: row.packSessions,
      packAchievements: row.packAchievements,
      settings: row.settings,
      updatedAt: row.updatedAt,
    })
    return
  }

  if (req.method === 'PUT') {
    let body: UserDataPayload
    try {
      body = JSON.parse(await readBody(req)) as UserDataPayload
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON' })
      return
    }
    const badDeck = offendingPublicDeckName(body.savedDecks)
    if (badDeck) {
      sendJson(res, 400, {
        error: `The public deck "${badDeck}" has a name with disallowed language. Rename it or make it private.`,
      })
      return
    }
    await ensureUserDataRow(userId)
    const patch: Partial<typeof userData.$inferInsert> = {}
    if (body.savedDecks !== undefined) patch.savedDecks = body.savedDecks
    if (body.packCollection !== undefined) patch.packCollection = body.packCollection
    if (body.packCardMeta !== undefined) patch.packCardMeta = body.packCardMeta
    if (body.packStats !== undefined) patch.packStats = body.packStats
    if (body.packSessions !== undefined) patch.packSessions = body.packSessions
    if (body.packAchievements !== undefined) patch.packAchievements = body.packAchievements
    if (body.settings !== undefined) patch.settings = body.settings
    const [row] = await db.update(userData).set(patch).where(eq(userData.userId, userId)).returning()
    sendJson(res, 200, { ok: true, updatedAt: row.updatedAt })
    return
  }

  if (req.method === 'POST' && req.url?.endsWith('/merge')) {
    let local: UserDataPayload
    try {
      local = JSON.parse(await readBody(req)) as UserDataPayload
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON' })
      return
    }
    const badMergeDeck = offendingPublicDeckName(local.savedDecks)
    if (badMergeDeck) {
      sendJson(res, 400, {
        error: `The public deck "${badMergeDeck}" has a name with disallowed language. Rename it or make it private.`,
      })
      return
    }
    const row = await ensureUserDataRow(userId)
    const serverDecks = Array.isArray(row.savedDecks) ? row.savedDecks : []
    const localDecks = Array.isArray(local.savedDecks) ? local.savedDecks : []
    const deckMap = new Map<string, unknown>()
    for (const d of serverDecks as { id?: string; updated?: number }[]) {
      if (d?.id) deckMap.set(d.id, d)
    }
    for (const d of localDecks as { id?: string; updated?: number }[]) {
      if (!d?.id) continue
      const prev = deckMap.get(d.id) as { updated?: number } | undefined
      if (!prev || (d.updated ?? 0) > (prev.updated ?? 0)) deckMap.set(d.id, d)
    }
    const merged = {
      savedDecks: [...deckMap.values()],
      packCollection: mergeObjects(row.packCollection, local.packCollection),
      packCardMeta: mergeObjects(row.packCardMeta, local.packCardMeta),
      packStats: mergeObjects(row.packStats, local.packStats),
      packSessions: mergeSessions(row.packSessions, local.packSessions),
      packAchievements: mergeObjects(row.packAchievements, local.packAchievements),
      settings: local.settings ?? row.settings,
    }
    const [updated] = await db.update(userData).set(merged).where(eq(userData.userId, userId)).returning()
    sendJson(res, 200, {
      savedDecks: updated.savedDecks,
      packCollection: updated.packCollection,
      packCardMeta: updated.packCardMeta,
      packStats: updated.packStats,
      packSessions: updated.packSessions,
      packAchievements: updated.packAchievements,
      settings: updated.settings,
      updatedAt: updated.updatedAt,
    })
    return
  }

  sendJson(res, 405, { error: 'Method not allowed' })
}

function mergeObjects(a: unknown, b: unknown): unknown {
  if (!a || typeof a !== 'object') return b ?? a
  if (!b || typeof b !== 'object') return a
  return { ...(a as Record<string, unknown>), ...(b as Record<string, unknown>) }
}

function mergeSessions(a: unknown, b: unknown): unknown {
  const sa = Array.isArray(a) ? a : []
  const sb = Array.isArray(b) ? b : []
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const s of [...sb, ...sa] as { id?: string }[]) {
    if (!s?.id || seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
  }
  return out.slice(0, 100)
}

export async function handleSessionMe(req: IncomingMessage, res: ServerResponse) {
  const session = await getSession(req)
  if (!session?.user) {
    sendJson(res, 200, { user: null })
    return
  }
  sendJson(res, 200, { user: session.user, session: { id: session.session.id, expiresAt: session.session.expiresAt } })
}
