import { and, desc, eq, sql } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { db } from '../db/index.js'
import { deckComments, deckLikes, deckViews, follows, user } from '../db/schema.js'
import { normalizeUsername } from '../username.js'
import { censorProfanity } from '../profanity.js'
import { clientIp } from '../rateLimit.js'
import { ensureUserDataRow, getSession, requireUser } from './userData.js'

const MAX_COMMENT_LEN = 2000

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage, max = 16_000): Promise<string> {
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

type UserRow = typeof user.$inferSelect

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

function userCard(row: {
  username: string | null
  displayName: string | null
  displayUsername?: string | null
  name?: string | null
  avatarUrl: string | null
  image?: string | null
}) {
  return {
    username: row.username,
    displayName: row.displayName ?? row.displayUsername ?? row.username ?? row.name ?? 'Unknown',
    avatarUrl: row.avatarUrl ?? row.image ?? null,
  }
}

function commanderFromCod(cod: unknown): string | null {
  if (typeof cod !== 'string') return null
  const m = /<zone name="side">[\s\S]*?<card[^>]*name="([^"]+)"/.exec(cod)
  return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null
}

async function resolveUserByUsername(username: string): Promise<UserRow | null> {
  const normalized = normalizeUsername(username)
  if (!normalized) return null
  const rows = await db.select().from(user).where(eq(user.usernameNormalized, normalized)).limit(1)
  return rows[0] ?? null
}

async function loadPublicDeck(
  username: string,
  deckId: string
): Promise<{ owner: UserRow; deck: SavedDeckRow } | null> {
  const owner = await resolveUserByUsername(username)
  if (!owner?.username) return null
  const dataRow = await ensureUserDataRow(owner.id)
  const decks = Array.isArray(dataRow.savedDecks) ? (dataRow.savedDecks as SavedDeckRow[]) : []
  const deck = decks.find((d) => d?.id === deckId && d.public)
  if (!deck) return null
  return { owner, deck }
}

async function scalarCount(query: Promise<{ c: number }[]>): Promise<number> {
  const rows = await query
  return rows[0]?.c ?? 0
}

function likeCount(ownerId: string, deckId: string) {
  return scalarCount(
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(deckLikes)
      .where(and(eq(deckLikes.ownerUserId, ownerId), eq(deckLikes.deckId, deckId)))
  )
}

function commentCount(ownerId: string, deckId: string) {
  return scalarCount(
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(deckComments)
      .where(and(eq(deckComments.ownerUserId, ownerId), eq(deckComments.deckId, deckId)))
  )
}

function viewCount(ownerId: string, deckId: string) {
  return scalarCount(
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(deckViews)
      .where(and(eq(deckViews.ownerUserId, ownerId), eq(deckViews.deckId, deckId)))
  )
}

async function viewerLiked(ownerId: string, deckId: string, viewerId: string | null): Promise<boolean> {
  if (!viewerId) return false
  const rows = await db
    .select({ c: sql<number>`1` })
    .from(deckLikes)
    .where(
      and(
        eq(deckLikes.ownerUserId, ownerId),
        eq(deckLikes.deckId, deckId),
        eq(deckLikes.userId, viewerId)
      )
    )
    .limit(1)
  return rows.length > 0
}

async function followerCount(userId: string) {
  return scalarCount(
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(follows)
      .where(eq(follows.followingId, userId))
  )
}

// ---- follows ---------------------------------------------------------------

async function handleFollow(req: IncomingMessage, res: ServerResponse, username: string) {
  const session = await requireUser(req, res)
  if (!session) return
  const target = await resolveUserByUsername(username)
  if (!target?.username) {
    sendJson(res, 404, { error: 'User not found' })
    return
  }
  if (target.id === session.user.id) {
    sendJson(res, 400, { error: "You can't follow yourself." })
    return
  }

  if (req.method === 'POST') {
    await db
      .insert(follows)
      .values({ followerId: session.user.id, followingId: target.id })
      .onConflictDoNothing()
  } else {
    await db
      .delete(follows)
      .where(and(eq(follows.followerId, session.user.id), eq(follows.followingId, target.id)))
  }
  sendJson(res, 200, {
    following: req.method === 'POST',
    followerCount: await followerCount(target.id),
  })
}

async function handleFollowList(
  res: ServerResponse,
  username: string,
  mode: 'followers' | 'following'
) {
  const target = await resolveUserByUsername(username)
  if (!target?.username) {
    sendJson(res, 404, { error: 'User not found' })
    return
  }
  const cols = {
    username: user.username,
    displayName: user.displayName,
    displayUsername: user.displayUsername,
    name: user.name,
    avatarUrl: user.avatarUrl,
    image: user.image,
  }
  const rows =
    mode === 'followers'
      ? await db
          .select(cols)
          .from(follows)
          .innerJoin(user, eq(user.id, follows.followerId))
          .where(eq(follows.followingId, target.id))
          .orderBy(desc(follows.createdAt))
          .limit(200)
      : await db
          .select(cols)
          .from(follows)
          .innerJoin(user, eq(user.id, follows.followingId))
          .where(eq(follows.followerId, target.id))
          .orderBy(desc(follows.createdAt))
          .limit(200)
  sendJson(res, 200, { users: rows.map(userCard), count: rows.length })
}

// ---- deck detail -----------------------------------------------------------

async function handleDeckDetail(req: IncomingMessage, res: ServerResponse, username: string, deckId: string) {
  const found = await loadPublicDeck(username, deckId)
  if (!found) {
    sendJson(res, 404, { error: 'Deck not found' })
    return
  }
  const { owner, deck } = found
  const session = await getSession(req)
  const viewerId = session?.user?.id ?? null
  const [likes, comments, views, liked] = await Promise.all([
    likeCount(owner.id, deckId),
    commentCount(owner.id, deckId),
    viewCount(owner.id, deckId),
    viewerLiked(owner.id, deckId, viewerId),
  ])
  sendJson(res, 200, {
    deckId,
    name: censorProfanity(deck.name ?? 'Untitled Deck'),
    cod: deck.cod ?? null,
    commander: deck.commander ?? commanderFromCod(deck.cod),
    colorIdentity: Array.isArray(deck.colorIdentity) ? deck.colorIdentity : null,
    cards: deck.cards ?? 0,
    updated: deck.updated ?? 0,
    owner: userCard(owner),
    likeCount: likes,
    commentCount: comments,
    viewCount: views,
    viewerLiked: liked,
  })
}

// ---- likes -----------------------------------------------------------------

async function handleLike(req: IncomingMessage, res: ServerResponse, username: string, deckId: string) {
  const session = await requireUser(req, res)
  if (!session) return
  const found = await loadPublicDeck(username, deckId)
  if (!found) {
    sendJson(res, 404, { error: 'Deck not found' })
    return
  }
  const { owner } = found
  if (req.method === 'POST') {
    await db
      .insert(deckLikes)
      .values({ ownerUserId: owner.id, deckId, userId: session.user.id })
      .onConflictDoNothing()
  } else {
    await db
      .delete(deckLikes)
      .where(
        and(
          eq(deckLikes.ownerUserId, owner.id),
          eq(deckLikes.deckId, deckId),
          eq(deckLikes.userId, session.user.id)
        )
      )
  }
  sendJson(res, 200, { liked: req.method === 'POST', likeCount: await likeCount(owner.id, deckId) })
}

// ---- views -----------------------------------------------------------------

async function handleView(req: IncomingMessage, res: ServerResponse, username: string, deckId: string) {
  const found = await loadPublicDeck(username, deckId)
  if (!found) {
    sendJson(res, 404, { error: 'Deck not found' })
    return
  }
  const { owner } = found
  const session = await getSession(req)
  const day = new Date().toISOString().slice(0, 10)
  const viewerKey = session?.user?.id
    ? `u:${session.user.id}`
    : `a:${createHash('sha256').update(`${clientIp(req)}:${day}`).digest('hex').slice(0, 32)}`
  await db
    .insert(deckViews)
    .values({ ownerUserId: owner.id, deckId, viewerKey, day })
    .onConflictDoNothing()
  sendJson(res, 200, { viewCount: await viewCount(owner.id, deckId) })
}

// ---- comments --------------------------------------------------------------

async function handleListComments(res: ServerResponse, username: string, deckId: string) {
  const found = await loadPublicDeck(username, deckId)
  if (!found) {
    sendJson(res, 404, { error: 'Deck not found' })
    return
  }
  const { owner } = found
  const rows = await db
    .select({
      id: deckComments.id,
      body: deckComments.body,
      createdAt: deckComments.createdAt,
      authorId: deckComments.authorId,
      username: user.username,
      displayName: user.displayName,
      displayUsername: user.displayUsername,
      name: user.name,
      avatarUrl: user.avatarUrl,
      image: user.image,
    })
    .from(deckComments)
    .innerJoin(user, eq(user.id, deckComments.authorId))
    .where(and(eq(deckComments.ownerUserId, owner.id), eq(deckComments.deckId, deckId)))
    .orderBy(desc(deckComments.createdAt))
    .limit(200)
  sendJson(res, 200, {
    comments: rows.map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      authorId: r.authorId,
      author: userCard(r),
    })),
  })
}

async function handleCreateComment(
  req: IncomingMessage,
  res: ServerResponse,
  username: string,
  deckId: string
) {
  const session = await requireUser(req, res)
  if (!session) return
  const found = await loadPublicDeck(username, deckId)
  if (!found) {
    sendJson(res, 404, { error: 'Deck not found' })
    return
  }
  let body: { body?: unknown }
  try {
    body = JSON.parse(await readBody(req)) as typeof body
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' })
    return
  }
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) {
    sendJson(res, 400, { error: 'Comment cannot be empty.' })
    return
  }
  if (text.length > MAX_COMMENT_LEN) {
    sendJson(res, 400, { error: `Comment must be ${MAX_COMMENT_LEN} characters or fewer.` })
    return
  }
  const { owner } = found
  const id = randomUUID()
  const clean = censorProfanity(text)
  await db.insert(deckComments).values({
    id,
    ownerUserId: owner.id,
    deckId,
    authorId: session.user.id,
    body: clean,
  })
  const [me] = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1)
  sendJson(res, 201, {
    id,
    body: clean,
    createdAt: new Date().toISOString(),
    authorId: session.user.id,
    author: me ? userCard(me) : { username: null, displayName: 'You', avatarUrl: null },
  })
}

async function handleDeleteComment(
  req: IncomingMessage,
  res: ServerResponse,
  username: string,
  deckId: string,
  commentId: string
) {
  const session = await requireUser(req, res)
  if (!session) return
  const owner = await resolveUserByUsername(username)
  if (!owner) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
  const [comment] = await db
    .select()
    .from(deckComments)
    .where(
      and(
        eq(deckComments.id, commentId),
        eq(deckComments.ownerUserId, owner.id),
        eq(deckComments.deckId, deckId)
      )
    )
    .limit(1)
  if (!comment) {
    sendJson(res, 404, { error: 'Comment not found' })
    return
  }
  if (comment.authorId !== session.user.id && owner.id !== session.user.id) {
    sendJson(res, 403, { error: 'You can only delete your own comments.' })
    return
  }
  await db.delete(deckComments).where(eq(deckComments.id, commentId))
  sendJson(res, 200, { ok: true })
}

// ---- dispatch --------------------------------------------------------------

const RE = {
  follow: /^\/api\/users\/([^/]+)\/follow$/,
  followers: /^\/api\/users\/([^/]+)\/followers$/,
  following: /^\/api\/users\/([^/]+)\/following$/,
  commentDelete: /^\/api\/users\/([^/]+)\/decks\/([^/]+)\/comments\/([^/]+)$/,
  comments: /^\/api\/users\/([^/]+)\/decks\/([^/]+)\/comments$/,
  like: /^\/api\/users\/([^/]+)\/decks\/([^/]+)\/like$/,
  view: /^\/api\/users\/([^/]+)\/decks\/([^/]+)\/view$/,
  deck: /^\/api\/users\/([^/]+)\/decks\/([^/]+)$/,
}

const dec = decodeURIComponent

/** True if the path belongs to the social/deck-social family. */
export function isSocialPath(path: string): boolean {
  return (
    RE.follow.test(path) ||
    RE.followers.test(path) ||
    RE.following.test(path) ||
    RE.deck.test(path) ||
    RE.like.test(path) ||
    RE.view.test(path) ||
    RE.comments.test(path) ||
    RE.commentDelete.test(path)
  )
}

export async function handleSocialRoutes(req: IncomingMessage, res: ServerResponse, path: string) {
  const method = req.method ?? 'GET'
  let m: RegExpExecArray | null

  if ((m = RE.follow.exec(path))) {
    if (method === 'POST' || method === 'DELETE') return handleFollow(req, res, dec(m[1]))
    return sendJson(res, 405, { error: 'Method not allowed' })
  }
  if ((m = RE.followers.exec(path)) && method === 'GET') return handleFollowList(res, dec(m[1]), 'followers')
  if ((m = RE.following.exec(path)) && method === 'GET') return handleFollowList(res, dec(m[1]), 'following')

  if ((m = RE.commentDelete.exec(path))) {
    if (method === 'DELETE') return handleDeleteComment(req, res, dec(m[1]), dec(m[2]), dec(m[3]))
    return sendJson(res, 405, { error: 'Method not allowed' })
  }
  if ((m = RE.comments.exec(path))) {
    if (method === 'GET') return handleListComments(res, dec(m[1]), dec(m[2]))
    if (method === 'POST') return handleCreateComment(req, res, dec(m[1]), dec(m[2]))
    return sendJson(res, 405, { error: 'Method not allowed' })
  }
  if ((m = RE.like.exec(path))) {
    if (method === 'POST' || method === 'DELETE') return handleLike(req, res, dec(m[1]), dec(m[2]))
    return sendJson(res, 405, { error: 'Method not allowed' })
  }
  if ((m = RE.view.exec(path)) && method === 'POST') return handleView(req, res, dec(m[1]), dec(m[2]))
  if ((m = RE.deck.exec(path)) && method === 'GET') return handleDeckDetail(req, res, dec(m[1]), dec(m[2]))

  sendJson(res, 404, { error: 'Not found' })
}
