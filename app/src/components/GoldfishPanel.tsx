import { useState } from 'react'
import type { Deck } from '../types'
import { cardImage } from '../scryfall'
import {
  createGoldfish,
  goldfishCastCommander,
  goldfishCastRock,
  goldfishDrawCard,
  goldfishEndTurn,
  goldfishKeep,
  goldfishMulligan,
  goldfishPlayLand,
  goldfishSummary,
  type GoldfishState,
} from '../goldfish'

export function GoldfishPanel({ deck }: { deck: Deck }) {
  const [state, setState] = useState<GoldfishState>(() => createGoldfish(deck))
  const [key, setKey] = useState(0)

  const restart = () => {
    setState(createGoldfish(deck))
    setKey((k) => k + 1)
  }

  const opening = state.phase === 'opening'

  return (
    <div className="goldfish" key={key}>
      <div className="goldfish-head">
        <h3>Goldfish Mode</h3>
        <p className="hint">
          Solo test your mana development — play lands, rocks, and cast your commander turn by
          turn.
        </p>
        <div className="goldfish-status">{goldfishSummary(state)}</div>
        <button type="button" className="copy-btn" onClick={restart}>
          Restart
        </button>
      </div>

      {opening ? (
        <div className="goldfish-actions">
          <button type="button" className="generate-btn" onClick={() => setState(goldfishKeep(state))}>
            Keep Hand
          </button>
          <button type="button" className="new-build" onClick={() => setState(goldfishMulligan(state))}>
            Mulligan
          </button>
        </div>
      ) : (
        <div className="goldfish-actions">
          <button
            type="button"
            className="new-build"
            disabled={state.landPlayedThisTurn || state.gameOver}
            onClick={() => setState(goldfishPlayLand(state, deck))}
          >
            Play Land
          </button>
          <button
            type="button"
            className="new-build"
            disabled={state.gameOver}
            onClick={() => setState(goldfishCastRock(state, deck))}
          >
            Cast Rock
          </button>
          <button
            type="button"
            className="new-build"
            disabled={state.commanderCast || state.gameOver}
            onClick={() => setState(goldfishCastCommander(state))}
          >
            Cast Commander
          </button>
          <button
            type="button"
            className="new-build"
            disabled={state.gameOver}
            onClick={() => setState(goldfishDrawCard(state))}
          >
            Draw
          </button>
          <button
            type="button"
            className="generate-btn"
            disabled={state.gameOver}
            onClick={() => setState(goldfishEndTurn(state))}
          >
            End Turn
          </button>
        </div>
      )}

      <div className="goldfish-board">
        <div className="goldfish-zone">
          <h4>Hand ({state.hand.length})</h4>
          <div className="goldfish-cards">
            {state.hand.map((c, i) => (
              <img key={`${c.name}-${i}`} src={cardImage(c, 'normal')} alt={c.name} title={c.name} />
            ))}
          </div>
        </div>
        <div className="goldfish-zone">
          <h4>Battlefield ({state.battlefield.length})</h4>
          <div className="goldfish-cards sm">
            {state.battlefield.map((p, i) => (
              <img
                key={`${p.card.name}-${i}`}
                src={cardImage(p.card, 'normal')}
                alt={p.card.name}
                title={p.card.name}
                className={p.tapped ? 'tapped' : ''}
              />
            ))}
          </div>
        </div>
        {state.commanderCast && (
          <div className="goldfish-zone">
            <h4>Commander</h4>
            <div className="goldfish-cards sm">
              <img src={cardImage(state.commander, 'normal')} alt={state.commander.name} />
            </div>
          </div>
        )}
      </div>

      <div className="goldfish-log">
        <h4>Log</h4>
        <div className="goldfish-log-body">
          {state.log.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
    </div>
  )
}
