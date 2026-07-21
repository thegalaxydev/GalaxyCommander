export type ProfileUser = {
  username: string | null
  displayName: string
  avatarUrl: string | null
}

export type DeckComment = {
  id: string
  body: string
  createdAt: string
  authorId: string
  author: ProfileUser
}

export type DeckDetail = {
  deckId: string
  name: string
  cod: string | null
  commander: string | null
  colorIdentity: string[] | null
  cards: number
  updated: number
  owner: ProfileUser
  likeCount: number
  commentCount: number
  viewCount: number
  viewerLiked: boolean
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(data?.error ?? fallback)
  return data as T
}

const u = (name: string) => encodeURIComponent(name)

export async function followUser(username: string): Promise<{ following: boolean; followerCount: number }> {
  const res = await fetch(`/api/users/${u(username)}/follow`, { method: 'POST', credentials: 'include' })
  return jsonOrThrow(res, 'Could not follow user')
}

export async function unfollowUser(username: string): Promise<{ following: boolean; followerCount: number }> {
  const res = await fetch(`/api/users/${u(username)}/follow`, { method: 'DELETE', credentials: 'include' })
  return jsonOrThrow(res, 'Could not unfollow user')
}

export async function fetchFollowList(
  username: string,
  mode: 'followers' | 'following'
): Promise<{ users: ProfileUser[]; count: number }> {
  const res = await fetch(`/api/users/${u(username)}/${mode}`, { credentials: 'include' })
  return jsonOrThrow(res, 'Could not load list')
}

export async function fetchDeckDetail(username: string, deckId: string): Promise<DeckDetail | null> {
  const res = await fetch(`/api/users/${u(username)}/decks/${u(deckId)}`, { credentials: 'include' })
  if (res.status === 404) return null
  return jsonOrThrow(res, 'Could not load deck')
}

export async function likeDeck(username: string, deckId: string): Promise<{ liked: boolean; likeCount: number }> {
  const res = await fetch(`/api/users/${u(username)}/decks/${u(deckId)}/like`, {
    method: 'POST',
    credentials: 'include',
  })
  return jsonOrThrow(res, 'Could not like deck')
}

export async function unlikeDeck(username: string, deckId: string): Promise<{ liked: boolean; likeCount: number }> {
  const res = await fetch(`/api/users/${u(username)}/decks/${u(deckId)}/like`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return jsonOrThrow(res, 'Could not unlike deck')
}

export async function recordDeckView(username: string, deckId: string): Promise<number> {
  try {
    const res = await fetch(`/api/users/${u(username)}/decks/${u(deckId)}/view`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return 0
    const data = (await res.json()) as { viewCount?: number }
    return data.viewCount ?? 0
  } catch {
    return 0
  }
}

export async function fetchComments(username: string, deckId: string): Promise<DeckComment[]> {
  const res = await fetch(`/api/users/${u(username)}/decks/${u(deckId)}/comments`, {
    credentials: 'include',
  })
  const data = await jsonOrThrow<{ comments: DeckComment[] }>(res, 'Could not load comments')
  return data.comments
}

export async function postComment(username: string, deckId: string, body: string): Promise<DeckComment> {
  const res = await fetch(`/api/users/${u(username)}/decks/${u(deckId)}/comments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  return jsonOrThrow(res, 'Could not post comment')
}

export async function deleteComment(username: string, deckId: string, commentId: string): Promise<void> {
  const res = await fetch(`/api/users/${u(username)}/decks/${u(deckId)}/comments/${u(commentId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? 'Could not delete comment')
  }
}
