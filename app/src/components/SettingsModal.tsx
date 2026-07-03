import { useEffect, useState } from 'react'
import type { AppSettings, LlmProvider } from '../settings'
import {
  DEFAULT_SETTINGS,
  PROVIDER_MODELS,
  SIM_ITERATION_OPTIONS,
  clearAllLocalData,
  saveSettings,
} from '../settings'
import { downloadSavedDecksExport, loadSavedDecks } from '../cod'
import {
  ACCENT_MODE_LABELS,
  UI_PRESET_LABELS,
  applyAppAppearance,
} from '../themes'

export function SettingsModal({
  open,
  onClose,
  settings,
  onSave,
  onClearData,
  commanderIdentity,
}: {
  open: boolean
  onClose: () => void
  settings: AppSettings
  onSave: (s: AppSettings) => void
  onClearData: () => void
  commanderIdentity?: string[] | null
}) {
  if (!open) return null
  return (
    <SettingsForm
      key={JSON.stringify(settings)}
      settings={settings}
      onClose={onClose}
      onSave={onSave}
      onClearData={onClearData}
      commanderIdentity={commanderIdentity}
    />
  )
}

function SettingsForm({
  onClose,
  settings,
  onSave,
  onClearData,
  commanderIdentity,
}: {
  onClose: () => void
  settings: AppSettings
  onSave: (s: AppSettings) => void
  onClearData: () => void
  commanderIdentity?: string[] | null
}) {
  const [draft, setDraft] = useState(settings)
  const savedCount = loadSavedDecks().length

  useEffect(() => {
    const preview = {
      uiPreset: draft.uiPreset,
      accentMode: draft.accentMode,
      showStarfield: draft.showStarfield,
      reducedMotion: draft.reducedMotion,
    }
    const saved = {
      uiPreset: settings.uiPreset,
      accentMode: settings.accentMode,
      showStarfield: settings.showStarfield,
      reducedMotion: settings.reducedMotion,
    }
    applyAppAppearance(preview, commanderIdentity)
    return () => applyAppAppearance(saved, commanderIdentity)
  }, [
    draft.uiPreset,
    draft.accentMode,
    draft.showStarfield,
    draft.reducedMotion,
    settings.uiPreset,
    settings.accentMode,
    settings.showStarfield,
    settings.reducedMotion,
    commanderIdentity,
  ])

  const setProvider = (provider: LlmProvider) => {
    const models = PROVIDER_MODELS[provider]
    setDraft((d) => ({
      ...d,
      llmProvider: provider,
      llmModel: models.includes(d.llmModel) ? d.llmModel : models[0],
    }))
  }

  const apply = () => {
    saveSettings(draft)
    onSave(draft)
    onClose()
  }

  const reset = () => {
    setDraft({ ...DEFAULT_SETTINGS, generatorDefaults: { ...DEFAULT_SETTINGS.generatorDefaults } })
  }

  const handleClearAll = () => {
    if (!window.confirm('Clear all settings and saved decks? This cannot be undone.')) return
    clearAllLocalData()
    onClearData()
    onClose()
  }

  const uiHint = UI_PRESET_LABELS.find((p) => p.id === draft.uiPreset)?.hint

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Settings</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="settings-section">
          <h3>Appearance</h3>
          <label className="settings-field">
            <span>Background theme</span>
            <select
              value={draft.uiPreset}
              onChange={(e) =>
                setDraft({ ...draft, uiPreset: e.target.value as AppSettings['uiPreset'] })
              }
            >
              {UI_PRESET_LABELS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {uiHint && <p className="hint">{uiHint}</p>}
          <label className="settings-field">
            <span>Accent colors</span>
            <select
              value={draft.accentMode}
              onChange={(e) =>
                setDraft({ ...draft, accentMode: e.target.value as AppSettings['accentMode'] })
              }
            >
              {ACCENT_MODE_LABELS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {draft.accentMode === 'commander' && (
            <p className="hint">
              Accents follow your selected commander&apos;s color identity.
            </p>
          )}
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.showStarfield}
              onChange={(e) => setDraft({ ...draft, showStarfield: e.target.checked })}
            />
            Show starfield background
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.reducedMotion}
              onChange={(e) => setDraft({ ...draft, reducedMotion: e.target.checked })}
            />
            Reduce motion (disable twinkling stars)
          </label>
          <div className="theme-preview" aria-hidden>
            <span className="theme-preview-swatch" />
            <span className="theme-preview-swatch accent" />
            <span className="theme-preview-swatch accent-b" />
          </div>
        </section>

        <section className="settings-section">
          <h3>General</h3>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.rememberDefaults}
              onChange={(e) => setDraft({ ...draft, rememberDefaults: e.target.checked })}
            />
            Remember generator defaults (bracket, budget, playstyle, sliders)
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.disableCardPreviews}
              onChange={(e) => setDraft({ ...draft, disableCardPreviews: e.target.checked })}
            />
            Disable card hover previews
          </label>
        </section>

        <section className="settings-section">
          <h3>Budget tiers</h3>
          <p className="hint">
            Maximum price per card for each budget level (USD). &quot;Any&quot; is always unlimited.
          </p>
          <div className="budget-cap-grid">
            {(
              [
                { key: 'low', label: '$' },
                { key: 'mid', label: '$$' },
                { key: 'high', label: '$$$' },
              ] as const
            ).map(({ key, label }) => (
              <label key={key} className="settings-field budget-cap-field">
                <span>{label} max</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.budgetCaps[key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      budgetCaps: {
                        ...draft.budgetCaps,
                        [key]: Math.max(1, Math.floor(Number(e.target.value) || 0)),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Playtest</h3>
          <label className="settings-field">
            <span>Opening hand simulation iterations</span>
            <select
              value={draft.simIterations}
              onChange={(e) => setDraft({ ...draft, simIterations: Number(e.target.value) })}
            >
              {SIM_ITERATION_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} hands
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-section">
          <h3>Deck Help — LLM</h3>
          <p className="hint">
            Optional free-form chat. API keys stay in your browser only. When disabled, Deck Help
            uses built-in rules.
          </p>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.llmEnabled}
              onChange={(e) => setDraft({ ...draft, llmEnabled: e.target.checked })}
            />
            Enable LLM chat
          </label>
          <label className="settings-field">
            <span>Provider</span>
            <select
              value={draft.llmProvider}
              onChange={(e) => setProvider(e.target.value as LlmProvider)}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.llmCustomModel}
              onChange={(e) => setDraft({ ...draft, llmCustomModel: e.target.checked })}
            />
            Use custom model name
          </label>
          {draft.llmCustomModel ? (
            <label className="settings-field">
              <span>Model</span>
              <input
                type="text"
                placeholder="gpt-4o-mini or llama3.2"
                value={draft.llmModel}
                onChange={(e) => setDraft({ ...draft, llmModel: e.target.value })}
              />
            </label>
          ) : (
            <label className="settings-field">
              <span>Model</span>
              <select
                value={draft.llmModel}
                onChange={(e) => setDraft({ ...draft, llmModel: e.target.value })}
              >
                {PROVIDER_MODELS[draft.llmProvider].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="settings-field">
            <span>API base URL (optional)</span>
            <input
              type="text"
              placeholder={
                draft.llmProvider === 'anthropic'
                  ? 'https://api.anthropic.com'
                  : 'https://api.openai.com/v1 or http://localhost:11434/v1'
              }
              value={draft.llmBaseUrl}
              onChange={(e) => setDraft({ ...draft, llmBaseUrl: e.target.value })}
            />
          </label>
          <label className="settings-field">
            <span>API key</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-..."
              value={draft.llmApiKey}
              onChange={(e) => setDraft({ ...draft, llmApiKey: e.target.value })}
            />
          </label>
        </section>

        <section className="settings-section">
          <h3>Data</h3>
          <p className="hint">
            {savedCount} saved deck{savedCount === 1 ? '' : 's'} in Deck Builder storage.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="new-build"
              disabled={savedCount === 0}
              onClick={() => downloadSavedDecksExport()}
            >
              Export saved decks
            </button>
            <button type="button" className="new-build danger" onClick={handleClearAll}>
              Clear all local data
            </button>
          </div>
        </section>

        <footer className="modal-foot">
          <button type="button" className="new-build" onClick={reset}>
            Reset settings
          </button>
          <button type="button" className="generate-btn" onClick={apply}>
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}
