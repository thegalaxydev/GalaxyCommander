export type AppView = 'generate' | 'builder' | 'packs'

export type AppPage =
  | { kind: 'app'; view: AppView }
  | { kind: 'userProfile'; username: string }
  | { kind: 'deck'; username: string; deckId: string }
  | { kind: 'profileSettings' }

const VIEW_PATH: Record<AppView, string> = {
  generate: '/generate',
  builder: '/builder',
  packs: '/packs',
}

const PATH_VIEW: Record<string, AppView> = {
  '/generate': 'generate',
  '/builder': 'builder',
  '/packs': 'packs',
}

export function pathForView(view: AppView): string {
  return VIEW_PATH[view]
}

export function isSharedDeckPath(pathname: string): boolean {
  return pathname === '/deck' || /^\/d\/[A-Za-z0-9_-]{4,16}$/.test(pathname)
}

export function usernameFromProfilePath(pathname: string): string | null {
  const match = /^\/users\/([a-zA-Z0-9_]+)$/.exec(pathname)
  return match?.[1] ?? null
}

export function deckFromPath(pathname: string): { username: string; deckId: string } | null {
  const match = /^\/users\/([a-zA-Z0-9_]+)\/decks\/([A-Za-z0-9_-]+)$/.exec(pathname)
  return match ? { username: match[1], deckId: match[2] } : null
}

export function isProfileSettingsPath(pathname: string): boolean {
  return pathname === '/settings/profile'
}

export function isReservedAppPath(pathname: string): boolean {
  return (
    isSharedDeckPath(pathname) ||
    usernameFromProfilePath(pathname) !== null ||
    deckFromPath(pathname) !== null ||
    isProfileSettingsPath(pathname)
  )
}

export function pageFromPathname(pathname: string): AppPage | null {
  if (pathname === '/' || pathname === '') return { kind: 'app', view: 'generate' }
  const deck = deckFromPath(pathname)
  if (deck) return { kind: 'deck', username: deck.username, deckId: deck.deckId }
  const profileUser = usernameFromProfilePath(pathname)
  if (profileUser) return { kind: 'userProfile', username: profileUser }
  if (isProfileSettingsPath(pathname)) return { kind: 'profileSettings' }
  const view = PATH_VIEW[pathname]
  if (view) return { kind: 'app', view }
  return null
}

export function viewFromPathname(pathname: string): AppView | null {
  if (pathname === '/' || pathname === '') return 'generate'
  return PATH_VIEW[pathname] ?? null
}

export function initialPage(hasSharedDeck: boolean): AppPage {
  if (hasSharedDeck) return { kind: 'app', view: 'builder' }
  const path = window.location.pathname
  if (isSharedDeckPath(path)) return { kind: 'app', view: 'builder' }
  return pageFromPathname(path) ?? { kind: 'app', view: 'generate' }
}

export function syncInitialRoute(): void {
  const { pathname } = window.location
  if (pathname === '/' || pathname === '') {
    window.history.replaceState({ page: { kind: 'app', view: 'generate' } }, '', '/generate')
    return
  }
  if (isReservedAppPath(pathname)) return
  const page = pageFromPathname(pathname)
  if (!page) window.history.replaceState({ page: { kind: 'app', view: 'generate' } }, '', '/generate')
}

export const NAVIGATE_EVENT = 'gc-navigate'

export function navigateToPage(page: AppPage, replace = false): void {
  let path = '/generate'
  if (page.kind === 'app') path = pathForView(page.view)
  else if (page.kind === 'userProfile') path = `/users/${page.username}`
  else if (page.kind === 'deck') path = `/users/${page.username}/decks/${page.deckId}`
  else if (page.kind === 'profileSettings') path = '/settings/profile'

  if (window.location.pathname === path) {
    window.dispatchEvent(new CustomEvent<AppPage>(NAVIGATE_EVENT, { detail: page }))
    return
  }
  if (replace) window.history.replaceState({ page }, '', path)
  else window.history.pushState({ page }, '', path)
  window.dispatchEvent(new CustomEvent<AppPage>(NAVIGATE_EVENT, { detail: page }))
}

export function navigateToView(view: AppView, replace = false): void {
  navigateToPage({ kind: 'app', view }, replace)
}

export function navigateToUserProfile(username: string): void {
  navigateToPage({ kind: 'userProfile', username })
}

export function navigateToDeck(username: string, deckId: string): void {
  navigateToPage({ kind: 'deck', username, deckId })
}

export function navigateToProfileSettings(): void {
  navigateToPage({ kind: 'profileSettings' })
}
