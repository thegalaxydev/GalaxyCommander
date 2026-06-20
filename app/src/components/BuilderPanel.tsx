import type { BudgetTier, GenStep, ScryCard } from '../types'
import { cardImage } from '../scryfall'
import { SvgIcon } from './Icons'
import { identityInfo } from '../iconData'
import { unionIdentity } from '../partner'
import { GenProgress } from './GenProgress'
import { ManaCost, renderSymbols } from './ManaCost'

interface Props {
  commander: ScryCard | null
  partner: ScryCard | null
  bracket: number
  budget: BudgetTier
  themes: string[]
  steps: GenStep[]
  generating: boolean
  expectedPower: number
  onGenerate: () => void
}

const BUDGET_TEXT: Record<BudgetTier, string> = {
  any: 'Any',
  low: '$',
  mid: '$$',
  high: '$$$',
}

export function BuilderPanel(props: Props) {
  const { commander, partner } = props
  const identity = commander ? identityInfo(unionIdentity(commander, partner)) : null
  return (
    <div className="builder-wrap">
      <div className="builder-card">
        {commander ? (
          <>
            <div
              className={`builder-art ${partner ? 'split' : ''}`}
              style={{ backgroundImage: `url(${cardImage(commander, 'art_crop')})` }}
            >
              {partner && (
                <div
                  className="builder-art-partner"
                  style={{ backgroundImage: `url(${cardImage(partner, 'art_crop')})` }}
                />
              )}
              <div className="builder-art-fade" />
              <h2>
                {commander.name.split(' //')[0]}
                {partner && (
                  <span className="partner-name"> &amp; {partner.name.split(' //')[0]}</span>
                )}
              </h2>
            </div>
            <div className="builder-meta">
              <div>
                <span>Identity</span>
                <strong className="identity-badge">
                  {identity!.icon && <SvgIcon name={identity!.icon} size={14} />}
                  {identity!.name}
                </strong>
              </div>
              <div>
                <span>Theme</span>
                <strong>{props.themes.length ? props.themes.join(' + ') : 'Auto-detect'}</strong>
              </div>
              <div>
                <span>Bracket</span>
                <strong>{props.bracket}</strong>
              </div>
              <div>
                <span>Budget</span>
                <strong>{BUDGET_TEXT[props.budget]}</strong>
              </div>
            </div>
            <hr className="builder-divider" />
            <div className="builder-oracle">
              <OracleBlock card={commander} />
              {partner && <OracleBlock card={partner} />}
            </div>
            <hr className="builder-divider" />
            <p className="builder-blurb">
              {props.themes.length
                ? `This deck will lean into ${props.themes.join(' and ')}, using ${
                    commander.name.split(',')[0]
                  } as the engine that ties the strategy together.`
                : `Pick a theme on the left, or let the generator infer one from how ${
                    commander.name.split(',')[0]
                  } is most commonly built.`}
            </p>
            <p className="builder-power">
              Expected Power: <strong>{props.expectedPower}/10</strong>
            </p>
            {props.generating ? (
              <GenProgress steps={props.steps} />
            ) : (
              <button className="generate-btn" onClick={props.onGenerate}>
                Generate Deck
              </button>
            )}
          </>
        ) : (
          <div className="builder-empty">
            <img src="/icon.png" alt="" />
            <h2>Deck Generator</h2>
            <p>
              Choose a commander to begin. Galaxy Commander pulls real inclusion and synergy data
              from EDHREC, prices from Scryfall, and assembles a tuned 100-card list around your
              constraints.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function OracleBlock({ card }: { card: ScryCard }) {
  const faces =
    card.card_faces && card.card_faces.length >= 2 ? card.card_faces : null
  if (faces) {
    return (
      <div className="oracle-block">
        {faces.map((face, i) => (
          <OracleFace
            key={i}
            name={face.name}
            mana={face.mana_cost ?? ''}
            type={face.type_line ?? ''}
            text={face.oracle_text ?? ''}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="oracle-block">
      <OracleFace
        name={card.name}
        mana={card.mana_cost ?? ''}
        type={card.type_line}
        text={card.oracle_text ?? ''}
      />
    </div>
  )
}

function OracleFace({
  name,
  mana,
  type,
  text,
}: {
  name: string
  mana: string
  type: string
  text: string
}) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  return (
    <div className="oracle-face">
      <div className="oracle-head">
        <strong>{name.split(' //')[0]}</strong>
        <ManaCost cost={mana} />
      </div>
      {type && <span className="oracle-type">{type}</span>}
      {lines.map((line, i) => (
        <p key={i}>{renderSymbols(line)}</p>
      ))}
    </div>
  )
}
