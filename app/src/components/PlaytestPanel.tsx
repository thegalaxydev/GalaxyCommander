import { useMemo, useState } from 'react'
import type { Deck } from '../types'
import { simulateHands, drawSampleHand, type SampleHand } from '../simulator'
import { cardImage } from '../scryfall'
import { GoldfishPanel } from './GoldfishPanel'

type PlayMode = 'sim' | 'goldfish'

export function PlaytestPanel({ deck, simIterations }: { deck: Deck; simIterations: number }) {
  const [mode, setMode] = useState<PlayMode>('sim')
  const sim = useMemo(() => simulateHands(deck, simIterations), [deck, simIterations])
  const [hand, setHand] = useState<SampleHand>(() => drawSampleHand(deck))

  return (
    <div className="playtest">
      <div className="playtest-modes">
        <button
          type="button"
          className={mode === 'sim' ? 'active' : ''}
          onClick={() => setMode('sim')}
        >
          Opening Hand Sim
        </button>
        <button
          type="button"
          className={mode === 'goldfish' ? 'active' : ''}
          onClick={() => setMode('goldfish')}
        >
          Goldfish
        </button>
      </div>

      {mode === 'goldfish' ? (
        <GoldfishPanel deck={deck} />
      ) : (
        <>
          <h3>Opening Hand Simulation</h3>
          <p className="hint">
            Based on {sim.iterations.toLocaleString()} shuffled opening hands of this exact 99.
          </p>
          <div className="sim-grid">
            <div className="sim-stat">
              <strong>{sim.avgLands.toFixed(1)}</strong>
              <span>Avg lands in opener</span>
            </div>
            <div className="sim-stat">
              <strong>{sim.avgRamp.toFixed(1)}</strong>
              <span>Avg ramp in opener</span>
            </div>
            <div className="sim-stat">
              <strong>{sim.avgDraw.toFixed(1)}</strong>
              <span>Avg draw spells</span>
            </div>
            <div className="sim-stat">
              <strong>{(sim.mulliganRate * 100).toFixed(1)}%</strong>
              <span>Mulligan rate (under 2 or over 5 lands)</span>
            </div>
            <div className="sim-stat">
              <strong>T{sim.avgCommanderTurn.toFixed(1)}</strong>
              <span>Avg commander cast turn</span>
            </div>
          </div>

          <h3>Commander Cast Probability</h3>
          <p className="hint">
            Chance of having {sim.commanderCmc} mana available (lands + rocks) by each turn.
          </p>
          <div className="sim-bars">
            {sim.commanderByTurn.map(({ turn, probability }) => (
              <div key={turn} className="sim-bar-row">
                <span className="sim-bar-label">Turn {turn}</span>
                <div className="sim-bar-track">
                  <div className="sim-bar-fill" style={{ width: `${probability * 100}%` }} />
                </div>
                <span className="sim-bar-pct">{(probability * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>

          <div className="sample-head">
            <h3>Sample Hand</h3>
            <span className={`keep-badge ${hand.keepable ? 'keep' : 'mull'}`}>
              {hand.lands} lands · {hand.keepable ? 'Keepable' : 'Mulligan'}
            </span>
            <button className="copy-btn" onClick={() => setHand(drawSampleHand(deck))}>
              Draw New Hand
            </button>
          </div>
          <div className="sample-hand">
            {hand.cards.map((card, i) => (
              <img key={`${card.name}-${i}`} src={cardImage(card, 'normal')} alt={card.name} title={card.name} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
