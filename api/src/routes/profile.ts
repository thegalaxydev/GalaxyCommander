import { and, eq, inArray, sql } from 'drizzle-orm'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { db } from '../db/index.js'
import { deckComments, deckLikes, deckViews, follows, user, userData } from '../db/schema.js'
import { normalizeUsername, validateUsername, isSameUsername, USERNAME_CHANGE_COOLDOWN_MS } from '../username.js'
import { saveUserAvatar, MAX_AVATAR_BYTES, avatarTooLargeMessage } from '../avatar.js'
import { ensureUserDataRow, getSession, requireUser } from './userData.js'
import { censorProfanity, hasProfanity } from '../profanity.js'

type SavedDeckRow = {
  id?: string
  name?: string
  cards?: number
  updated?: number
  public?: boolean
  commander?: string
  colorIdentity?: string[]
  cod?: string
}

/** Fallback for decks saved before commander/colors were stored: pull the first
 *  commander name out of the .cod XML side zone. */
function commanderFromCod(cod: unknown): string | null {
  if (typeof cod !== 'string') return null
  const m = /<zone name="side">[\s\S]*?<card[^>]*name="([^"]+)"/.exec(cod)
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage, max = 64_000): Promise<string> {
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

function usernameChangeInfo(row: typeof user.$inferSelect) {
  const changedAt = row.usernameChangedAt
  if (!changedAt) {
    return { canChangeUsername: true, usernameChangedAt: null, usernameChangeAvailableAt: null }
  }
  const availableAt = new Date(changedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS)
  const canChangeUsername = Date.now() >= availableAt.getTime()
  return {
    canChangeUsername,
    usernameChangedAt: changedAt.toISOString(),
    usernameChangeAvailableAt: canChangeUsername ? null : availableAt.toISOString(),
  }
}

function publicProfileFields(row: typeof user.$inferSelect) {
  return {
    username: row.username,
    displayName: row.displayName ?? row.displayUsername ?? row.username ?? row.name,
    bio: row.bio ?? '',
    avatarUrl: row.avatarUrl ?? row.image ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function publicDecksFromRow(decks: unknown) {
  if (!Array.isArray(decks)) return []
  return (decks as SavedDeckRow[])
    .filter((d) => d?.public && d.id && d.name)
    .map((d) => ({
      id: d.id,
      // Censor names shown to other users; the owner still sees the original.
      name: censorProfanity(d.name as string),
      cards: d.cards ?? 0,
      updated: d.updated ?? 0,
      commander: d.commander ?? commanderFromCod(d.cod),
      colorIdentity: Array.isArray(d.colorIdentity) ? d.colorIdentity : null,
    }))
    .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
}

type BaseDeck = { id?: string; [k: string]: unknown }

/** Attach like/comment/view counts (and viewerLiked) to a deck list via grouped
 *  aggregate queries — one query per metric regardless of deck count. */
async function attachDeckSocial<T extends BaseDeck>(
  ownerId: string,
  decks: T[],
  viewerId: string | null
): Promise<(T & { likeCount: number; commentCount: number; viewCount: number; viewerLiked: boolean })[]> {
  const ids = decks.map((d) => d.id).filter((id): id is string => typeof id === 'string')
  const likes = new Map<string, number>()
  const comments = new Map<string, number>()
  const views = new Map<string, number>()
  const liked = new Set<string>()
  if (ids.length) {
    const [lr, cr, vr, likedRows] = await Promise.all([
      db
        .select({ deckId: deckLikes.deckId, c: sql<number>`count(*)::int` })
        .from(deckLikes)
        .where(and(eq(deckLikes.ownerUserId, ownerId), inArray(deckLikes.deckId, ids)))
        .groupBy(deckLikes.deckId),
      db
        .select({ deckId: deckComments.deckId, c: sql<number>`count(*)::int` })
        .from(deckComments)
        .where(and(eq(deckComments.ownerUserId, ownerId), inArray(deckComments.deckId, ids)))
        .groupBy(deckComments.deckId),
      db
        .select({ deckId: deckViews.deckId, c: sql<number>`count(*)::int` })
        .from(deckViews)
        .where(and(eq(deckViews.ownerUserId, ownerId), inArray(deckViews.deckId, ids)))
        .groupBy(deckViews.deckId),
      viewerId
        ? db
            .select({ deckId: deckLikes.deckId })
            .from(deckLikes)
            .where(
              and(
                eq(deckLikes.ownerUserId, ownerId),
                eq(deckLikes.userId, viewerId),
                inArray(deckLikes.deckId, ids)
              )
            )
        : Promise.resolve([] as { deckId: string }[]),
    ])
    for (const r of lr) likes.set(r.deckId, r.c)
    for (const r of cr) comments.set(r.deckId, r.c)
    for (const r of vr) views.set(r.deckId, r.c)
    for (const r of likedRows) liked.add(r.deckId)
  }
  return decks.map((d) => ({
    ...d,
    likeCount: likes.get(d.id ?? '') ?? 0,
    commentCount: comments.get(d.id ?? '') ?? 0,
    viewCount: views.get(d.id ?? '') ?? 0,
    viewerLiked: liked.has(d.id ?? ''),
  }))
}

async function followStats(userId: string, viewerId: string | null) {
  const [fr, fg, vf] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followingId, userId)),
    db.select({ c: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, userId)),
    viewerId && viewerId !== userId
      ? db
          .select({ c: sql<number>`1` })
          .from(follows)
          .where(and(eq(follows.followerId, viewerId), eq(follows.followingId, userId)))
          .limit(1)
      : Promise.resolve([] as { c: number }[]),
  ])
  return {
    followerCount: fr[0]?.c ?? 0,
    followingCount: fg[0]?.c ?? 0,
    viewerFollows: vf.length > 0,
  }
}

export async function handleGetPublicProfile(
  req: IncomingMessage,
  res: ServerResponse,
  usernameParam: string
) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const normalized = normalizeUsername(usernameParam)
  if (!normalized) {
    sendJson(res, 404, { error: 'User not found' })
    return
  }

  const rows = await db
    .select()
    .from(user)
    .where(eq(user.usernameNormalized, normalized))
    .limit(1)

  const row = rows[0]
  if (!row?.username) {
    sendJson(res, 404, { error: 'User not found' })
    return
  }

  const dataRow = await ensureUserDataRow(row.id)
  const session = await getSession(req)
  const viewerId = session?.user?.id ?? null
  const baseDecks = publicDecksFromRow(dataRow.savedDecks)
  const [decks, follow] = await Promise.all([
    attachDeckSocial(row.id, baseDecks, viewerId),
    followStats(row.id, viewerId),
  ])
  sendJson(res, 200, {
    ...publicProfileFields(row),
    ...follow,
    decks,
  })
}

function validateDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return 'Display name must be text.'
  const trimmed = value.trim()
  if (!trimmed) return 'Display name is required.'
  if (trimmed.length > 50) return 'Display name must be 50 characters or fewer.'
  if (hasProfanity(trimmed)) return 'Display name contains disallowed language.'
  return null
}

function validateBio(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return 'Bio must be text.'
  if (value.length > 500) return 'Bio must be 500 characters or fewer.'
  if (hasProfanity(value)) return 'Bio contains disallowed language.'
  return null
}

export async function handlePatchMyProfile(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'PATCH') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const session = await requireUser(req, res)
  if (!session) return

  let body: {
    displayName?: unknown
    bio?: unknown
    publicDeckIds?: unknown
  }
  try {
    body = JSON.parse(await readBody(req)) as typeof body
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' })
    return
  }

  const userId = session.user.id
  const [current] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  if (!current) {
    sendJson(res, 404, { error: 'User not found' })
    return
  }

  const patch: Partial<typeof user.$inferInsert> = {}

  if (body.displayName !== undefined) {
    const err = validateDisplayName(body.displayName)
    if (err) {
      sendJson(res, 400, { error: err })
      return
    }
    patch.displayName = (body.displayName as string).trim()
    patch.name = patch.displayName
  }

  if (body.bio !== undefined) {
    const err = validateBio(body.bio)
    if (err) {
      sendJson(res, 400, { error: err })
      return
    }
    patch.bio = typeof body.bio === 'string' ? body.bio : ''
  }

  let updatedDecks: unknown | undefined
  if (body.publicDeckIds !== undefined) {
    if (!Array.isArray(body.publicDeckIds) || !body.publicDeckIds.every((id) => typeof id === 'string')) {
      sendJson(res, 400, { error: 'publicDeckIds must be an array of deck ids.' })
      return
    }
    const publicSet = new Set(body.publicDeckIds as string[])
    const dataRow = await ensureUserDataRow(userId)
    const decks = Array.isArray(dataRow.savedDecks) ? [...(dataRow.savedDecks as SavedDeckRow[])] : []
    const offending = decks.find(
      (d) => d?.id && publicSet.has(d.id) && typeof d.name === 'string' && hasProfanity(d.name)
    )
    if (offending) {
      sendJson(res, 400, {
        error: `Rename "${offending.name}" before making it public — it contains disallowed language.`,
      })
      return
    }
    updatedDecks = decks.map((d) => (d?.id ? { ...d, public: publicSet.has(d.id) } : d))
    await db.update(userData).set({ savedDecks: updatedDecks }).where(eq(userData.userId, userId))
  }

  if (Object.keys(patch).length === 0 && updatedDecks === undefined) {
    sendJson(res, 400, { error: 'No profile fields to update.' })
    return
  }

  let row = current
  if (Object.keys(patch).length > 0) {
    const [updated] = await db.update(user).set(patch).where(eq(user.id, userId)).returning()
    row = updated
  }

  const dataRow = await ensureUserDataRow(userId)
  sendJson(res, 200, {
    ...publicProfileFields(row),
    decks: publicDecksFromRow(updatedDecks ?? dataRow.savedDecks),
  })
}

export async function handlePatchMyUsername(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'PATCH') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const session = await requireUser(req, res)
  if (!session) return

  let body: { username?: unknown }
  try {
    body = JSON.parse(await readBody(req)) as typeof body
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' })
    return
  }

  if (typeof body.username !== 'string') {
    sendJson(res, 400, { error: 'Username is required.' })
    return
  }

  const nextUsername = body.username.trim()
  const err = validateUsername(nextUsername)
  if (err) {
    sendJson(res, 400, { error: err })
    return
  }

  const normalized = normalizeUsername(nextUsername)
  const userId = session.user.id

  const [current] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  if (!current) {
    sendJson(res, 404, { error: 'User not found' })
    return
  }

  const capitalizationOnly =
    normalized === current.usernameNormalized &&
    nextUsername !== current.username &&
    isSameUsername(nextUsername, current.username ?? '')

  if (!capitalizationOnly) {
    if (current.usernameChangedAt) {
      const availableAt = current.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS
      if (Date.now() < availableAt) {
        const daysLeft = Math.ceil((availableAt - Date.now()) / (24 * 60 * 60 * 1000))
        sendJson(res, 429, {
          error: `You can change your username again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
        })
        return
      }
    }

    const taken = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.usernameNormalized, normalized))
      .limit(1)

    if (taken[0] && taken[0].id !== userId) {
      sendJson(res, 409, { error: 'That username is already taken.' })
      return
    }
  }

  const patch: Partial<typeof user.$inferInsert> = {
    username: nextUsername,
    displayUsername: nextUsername,
  }
  if (!capitalizationOnly) {
    patch.usernameNormalized = normalized
    patch.usernameChangedAt = new Date()
  }

  const [row] = await db.update(user).set(patch).where(eq(user.id, userId)).returning()

  sendJson(res, 200, publicProfileFields(row))
}

export async function handlePostMyAvatar(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const session = await requireUser(req, res)
  if (!session) return

  let body: { data?: unknown; contentType?: unknown }
  try {
    body = JSON.parse(await readBody(req, 3_000_000)) as typeof body
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' })
    return
  }

  if (typeof body.data !== 'string' || !body.data) {
    sendJson(res, 400, { error: 'Image data is required.' })
    return
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(body.data, 'base64')
  } catch {
    sendJson(res, 400, { error: 'Invalid image data.' })
    return
  }

  if (buffer.length > MAX_AVATAR_BYTES) {
    sendJson(res, 400, { error: avatarTooLargeMessage() })
    return
  }

  try {
    const avatarUrl = await saveUserAvatar(session.user.id, buffer)
    const [row] = await db
      .update(user)
      .set({ avatarUrl, image: avatarUrl })
      .where(eq(user.id, session.user.id))
      .returning()
    sendJson(res, 200, publicProfileFields(row))
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : 'Could not save avatar.' })
  }
}

export async function handleDeleteMyAvatar(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'DELETE') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const session = await requireUser(req, res)
  if (!session) return

  const { removeUserAvatars } = await import('../avatar.js')
  await removeUserAvatars(session.user.id)
  const [row] = await db
    .update(user)
    .set({ avatarUrl: null, image: null })
    .where(eq(user.id, session.user.id))
    .returning()
  sendJson(res, 200, publicProfileFields(row))
}

export async function handleGetMyProfile(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const session = await requireUser(req, res)
  if (!session) return

  const [row] = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1)
  if (!row) {
    sendJson(res, 404, { error: 'User not found' })
    return
  }

  const dataRow = await ensureUserDataRow(row.id)
  const decks = Array.isArray(dataRow.savedDecks) ? (dataRow.savedDecks as SavedDeckRow[]) : []
  const baseDecks = decks
    .filter((d) => d?.id && d.name)
    .map((d) => ({
      id: d.id,
      name: d.name,
      cards: d.cards ?? 0,
      updated: d.updated ?? 0,
      public: !!d.public,
      commander: d.commander ?? commanderFromCod(d.cod),
      colorIdentity: Array.isArray(d.colorIdentity) ? d.colorIdentity : null,
    }))
    .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
  const [withSocial, follow] = await Promise.all([
    attachDeckSocial(row.id, baseDecks, row.id),
    followStats(row.id, null),
  ])
  sendJson(res, 200, {
    ...publicProfileFields(row),
    ...usernameChangeInfo(row),
    ...follow,
    decks: withSocial,
  })
}

export async function handleProfileRoutes(req: IncomingMessage, res: ServerResponse, path: string) {
  if (path === '/api/me/profile') {
    if (req.method === 'GET') return handleGetMyProfile(req, res)
    if (req.method === 'PATCH') return handlePatchMyProfile(req, res)
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  if (path === '/api/me/avatar') {
    if (req.method === 'POST') return handlePostMyAvatar(req, res)
    if (req.method === 'DELETE') return handleDeleteMyAvatar(req, res)
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  if (path === '/api/me/username' && req.method === 'PATCH') {
    return handlePatchMyUsername(req, res)
  }

  const userMatch = /^\/api\/users\/([^/]+)$/.exec(path)
  if (userMatch) {
    return handleGetPublicProfile(req, res, decodeURIComponent(userMatch[1]))
  }

  sendJson(res, 404, { error: 'Not found' })
}
