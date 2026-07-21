export type PublicProfile = {
  username: string | null
  displayName: string
  bio: string
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
  decks: PublicDeck[]
  followerCount: number
  followingCount: number
  viewerFollows?: boolean
}

export type PublicDeck = {
  id: string
  name: string
  cards: number
  updated: number
  public?: boolean
  commander?: string | null
  colorIdentity?: string[] | null
  likeCount?: number
  commentCount?: number
  viewCount?: number
  viewerLiked?: boolean
}

export type MyProfile = PublicProfile & {
  canChangeUsername?: boolean
  usernameChangedAt?: string | null
  usernameChangeAvailableAt?: string | null
  decks: (PublicDeck & { public: boolean })[]
}

export async function fetchPublicProfile(username: string): Promise<PublicProfile | null> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, { credentials: 'include' })
  if (res.status === 404) return null
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? 'Could not load profile')
  }
  return (await res.json()) as PublicProfile
}

export async function fetchMyProfile(): Promise<MyProfile> {
  const res = await fetch('/api/me/profile', { credentials: 'include' })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? 'Could not load profile')
  }
  return (await res.json()) as MyProfile
}

export async function updateMyProfile(body: {
  displayName?: string
  bio?: string
  publicDeckIds?: string[]
}): Promise<MyProfile> {
  const res = await fetch('/api/me/profile', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as MyProfile & { error?: string }
  if (!res.ok) throw new Error(data?.error ?? 'Could not update profile')
  return data
}

export async function updateMyUsername(username: string): Promise<PublicProfile> {
  const res = await fetch('/api/me/username', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  })
  const data = (await res.json().catch(() => null)) as PublicProfile & { error?: string }
  if (!res.ok) throw new Error(data?.error ?? 'Could not update username')
  return data
}

export const MAX_AVATAR_MB = 2
export const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024

export function avatarTooLargeMessage(): string {
  return `Image must be ${MAX_AVATAR_MB} MB or smaller.`
}

export async function uploadMyAvatar(file: File): Promise<string> {
  if (file.size > MAX_AVATAR_BYTES) throw new Error(avatarTooLargeMessage())
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowed.includes(file.type)) throw new Error('Only JPEG, PNG, WebP, and GIF images are allowed.')

  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Could not read image.'))
        return
      }
      const base64 = result.split(',')[1]
      if (!base64) {
        reject(new Error('Could not read image.'))
        return
      }
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Could not read image.'))
    reader.readAsDataURL(file)
  })

  const res = await fetch('/api/me/avatar', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, contentType: file.type }),
  })
  const body = (await res.json().catch(() => null)) as { avatarUrl?: string; error?: string }
  if (!res.ok) throw new Error(body?.error ?? 'Could not upload avatar')
  if (!body?.avatarUrl) throw new Error('Could not upload avatar')
  return body.avatarUrl
}

export async function removeMyAvatar(): Promise<void> {
  const res = await fetch('/api/me/avatar', { method: 'DELETE', credentials: 'include' })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? 'Could not remove avatar')
  }
}

export async function checkUsernameAvailable(username: string): Promise<boolean> {
  const res = await fetch('/api/auth/is-username-available', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim() }),
  })
  const data = (await res.json()) as { available?: boolean }
  return !!data.available
}
