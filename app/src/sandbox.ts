import type { Deck, ScryCard } from './types'

export type ZoneId =
  | 'library'
  | 'hand'
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'stack'
  | 'command'

export const ZONE_LABELS: Record<ZoneId, string> = {
  library: 'Library',
  hand: 'Hand',
  battlefield: 'Battlefield',
  graveyard: 'Graveyard',
  exile: 'Exile',
  stack: 'Stack',
  command: 'Command Zone',
}

export interface TableCard {
  iid: string
  card: ScryCard
  tapped: boolean
  flipped: boolean
  x: number
  y: number
}

export type Zones = Record<ZoneId, TableCard[]>

export interface SandboxState {
  zones: Zones
  life: number
  turn: number
  log: string[]
}

export type SandboxAction =
  | { type: 'reset'; deck: Deck }
  | { type: 'move'; iid: string; from: ZoneId; to: ZoneId; x?: number; y?: number; toBottom?: boolean }
  | { type: 'tap'; iid: string }
  | { type: 'flip'; iid: string }
  | { type: 'draw'; n?: number }
  | { type: 'mulligan' }
  | { type: 'untapAll' }
  | { type: 'nextTurn' }
  | { type: 'shuffle' }
  | { type: 'life'; delta: number }

const short = (c: ScryCard) => c.name.split(' //')[0]

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function wrap(card: ScryCard): TableCard {
  return { iid: crypto.randomUUID(), card, tapped: false, flipped: false, x: 0, y: 0 }
}

function emptyZones(): Zones {
  return { library: [], hand: [], battlefield: [], graveyard: [], exile: [], stack: [], command: [] }
}

function trimLog(log: string[]): string[] {
  return log.slice(-40)
}

export function createSandbox(deck: Deck): SandboxState {
  const zones = emptyZones()
  const commanders = deck.cards.filter((d) => d.category === 'Commander')
  zones.command = commanders.map((d) => wrap(d.card))
  const lib: TableCard[] = []
  for (const d of deck.cards) {
    if (d.category === 'Commander') continue
    for (let i = 0; i < d.qty; i++) lib.push(wrap(d.card))
  }
  const library = shuffle(lib)
  zones.hand = library.splice(0, 7)
  zones.library = library
  return {
    zones,
    life: 40,
    turn: 1,
    log: ['New game — drew an opening hand of seven.'],
  }
}

export function sandboxReducer(state: SandboxState, action: SandboxAction): SandboxState {
  switch (action.type) {
    case 'reset':
      return createSandbox(action.deck)

    case 'move': {
      const src = state.zones[action.from]
      const card = src.find((c) => c.iid === action.iid)
      if (!card) return state
      const zones: Zones = { ...state.zones, [action.from]: src.filter((c) => c.iid !== action.iid) }
      if (action.from !== action.to) zones[action.to] = [...state.zones[action.to]]
      const moved: TableCard = {
        ...card,
        tapped: action.to === 'battlefield' ? card.tapped : false,
        flipped: action.to === 'battlefield' || action.to === 'hand' ? card.flipped : false,
        x: action.x ?? card.x,
        y: action.y ?? card.y,
      }
      if (action.to === 'library' && !action.toBottom) zones[action.to].unshift(moved)
      else zones[action.to].push(moved)
      const note =
        action.from === action.to
          ? null
          : `${short(card.card)} → ${ZONE_LABELS[action.to]}`
      return { ...state, zones, log: note ? trimLog([...state.log, note]) : state.log }
    }

    case 'tap': {
      const battlefield = state.zones.battlefield.map((c) =>
        c.iid === action.iid ? { ...c, tapped: !c.tapped } : c
      )
      return { ...state, zones: { ...state.zones, battlefield } }
    }

    case 'flip': {
      const flipOne = (list: TableCard[]) =>
        list.map((c) => (c.iid === action.iid ? { ...c, flipped: !c.flipped } : c))
      return {
        ...state,
        zones: { ...state.zones, battlefield: flipOne(state.zones.battlefield), hand: flipOne(state.zones.hand) },
      }
    }

    case 'draw': {
      const n = action.n ?? 1
      const library = [...state.zones.library]
      const hand = [...state.zones.hand]
      let drawn = 0
      for (let i = 0; i < n && library.length; i++) {
        hand.push(library.shift()!)
        drawn++
      }
      const log = drawn
        ? trimLog([...state.log, `Drew ${drawn} card${drawn > 1 ? 's' : ''}.`])
        : trimLog([...state.log, 'Library is empty.'])
      return { ...state, zones: { ...state.zones, library, hand }, log }
    }

    case 'mulligan': {
      const all = shuffle([...state.zones.library, ...state.zones.hand])
      const hand = all.splice(0, 7)
      return {
        ...state,
        zones: { ...state.zones, library: all, hand },
        log: trimLog([...state.log, 'Mulligan — reshuffled and drew seven.']),
      }
    }

    case 'untapAll': {
      const battlefield = state.zones.battlefield.map((c) => ({ ...c, tapped: false }))
      return { ...state, zones: { ...state.zones, battlefield }, log: trimLog([...state.log, 'Untapped everything.']) }
    }

    case 'nextTurn': {
      const battlefield = state.zones.battlefield.map((c) => ({ ...c, tapped: false }))
      const library = [...state.zones.library]
      const hand = [...state.zones.hand]
      const turn = state.turn + 1
      if (library.length) hand.push(library.shift()!)
      return {
        ...state,
        turn,
        zones: { ...state.zones, battlefield, library, hand },
        log: trimLog([...state.log, `--- Turn ${turn} --- untapped and drew for turn.`]),
      }
    }

    case 'shuffle':
      return {
        ...state,
        zones: { ...state.zones, library: shuffle(state.zones.library) },
        log: trimLog([...state.log, 'Shuffled the library.']),
      }

    case 'life':
      return { ...state, life: state.life + action.delta }

    default:
      return state
  }
}
