import type { BudgetTier, GenStep, ScryCard } from '../types'
import { cardImage } from '../scryfall'
import { SvgIcon } from './Icons'
import { identityInfo } from '../iconData'
import { unionIdentity } from '../partner'
import { GenProgress } from './GenProgress'

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
