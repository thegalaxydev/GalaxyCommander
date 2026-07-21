import type { AppSettings } from '../settings'
import type { SavedDeck } from '../cod'

export interface RemoteUserData {
  savedDecks: SavedDeck[]
  packCollection: Record<string, { q: number; fq?: number }>
  packCardMeta: Record<string, unknown>
  packStats: Record<string, unknown>
  packSessions: unknown[]
  packAchievements: Record<string, number>
  settings: AppSettings | null
  updatedAt?: string
}

const KEYS = {
  savedDecks: 'gc-saved-decks',
  packCollection: 'gc-pack-collection',
  packCardMeta: 'gc-pack-cardmeta',
  packStats: 'gc-pack-stats',
  packSessions: 'gc-pack-sessions',
  packAchievements: 'gc-pack-achievements',
  settings: 'galaxy-commander-settings',
} as const

export function collectLocalUserData(): Partial<RemoteUserData> {
  const read = (key: string) => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : undefined
    } catch {
      return undefined
    }
  }
  return {
    savedDecks: read(KEYS.savedDecks),
    packCollection: read(KEYS.packCollection),
    packCardMeta: read(KEYS.packCardMeta),
    packStats: read(KEYS.packStats),
    packSessions: read(KEYS.packSessions),
    packAchievements: read(KEYS.packAchievements),
    settings: read(KEYS.settings),
  }
}

export function applyRemoteUserData(data: RemoteUserData): void {
  if (data.savedDecks !== undefined) localStorage.setItem(KEYS.savedDecks, JSON.stringify(data.savedDecks))
  if (data.packCollection !== undefined)
    localStorage.setItem(KEYS.packCollection, JSON.stringify(data.packCollection))
  if (data.packCardMeta !== undefined) localStorage.setItem(KEYS.packCardMeta, JSON.stringify(data.packCardMeta))
  if (data.packStats !== undefined) localStorage.setItem(KEYS.packStats, JSON.stringify(data.packStats))
  if (data.packSessions !== undefined) localStorage.setItem(KEYS.packSessions, JSON.stringify(data.packSessions))
  if (data.packAchievements !== undefined)
    localStorage.setItem(KEYS.packAchievements, JSON.stringify(data.packAchievements))
  if (data.settings !== undefined && data.settings !== null)
    localStorage.setItem(KEYS.settings, JSON.stringify(data.settings))
}

let syncTimer: ReturnType<typeof setTimeout> | null = null
let loggedIn = false

export function setSyncEnabled(on: boolean): void {
  loggedIn = on
}

export function scheduleUserDataSync(): void {
  if (!loggedIn) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    void pushLocalUserData()
  }, 1500)
}

export async function fetchSessionUser(): Promise<{ id: string; name: string; email: string } | null> {
  const res = await fetch('/api/session', { credentials: 'include' })
  if (!res.ok) return null
  const data = (await res.json()) as { user: { id: string; name: string; email: string } | null }
  return data.user
}

export async function mergeOnLogin(): Promise<RemoteUserData | null> {
  const local = collectLocalUserData()
  const res = await fetch('/api/user/data/merge', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(local),
  })
  if (!res.ok) return null
  const data = (await res.json()) as RemoteUserData
  applyRemoteUserData(data)
  return data
}

export async function pullUserData(): Promise<RemoteUserData | null> {
  const res = await fetch('/api/user/data', { credentials: 'include' })
  if (!res.ok) return null
  const remote = (await res.json()) as RemoteUserData
  const res2 = await fetch('/api/user/data/merge', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectLocalUserData()),
  })
  if (!res2.ok) {
    applyRemoteUserData(remote)
    return remote
  }
  const merged = (await res2.json()) as RemoteUserData
  applyRemoteUserData(merged)
  return merged
}

export async function pushLocalUserData(): Promise<void> {
  const local = collectLocalUserData()
  await fetch('/api/user/data', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(local),
  })
}
