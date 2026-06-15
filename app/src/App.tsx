import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AdvancedOptions,
  BudgetTier,
  BuildSettings,
  ChatMessage,
  ComboInfo,
  Deck,
  DeckCard,
  DeckPersonality,
  GenStep,
  PowerProfile,
  ScryCard,
  UpgradeTier,
} from './types'
import { GEN_STEPS, computeTieredUpgrades, generateDeck, swapExpensiveCards } from './generator'
import { findCombos } from './combos'
import { commanderSlug, fetchEdhrecPage, fetchEdhrecPageBySlug, type EdhrecTheme } from './edhrec'
import { unionIdentity } from './partner'
import { setAllowUnsetCards } from './scryfall'
import { applyAppAppearance } from './themes'
import { handleChat, type VariantKind } from './chat'
import { askLlm, llmConfigured } from './llmChat'
import {
  defaultGeneratorDefaults,
  loadSettings,
  saveSettings,
  type AppSettings,
} from './settings'
import { Sidebar } from './components/Sidebar'
import { BuilderPanel } from './components/BuilderPanel'
import { StatsPanel } from './components/StatsPanel'
import { DeckView } from './components/DeckView'
import { ChatPanel } from './components/ChatPanel'
import { DeckBuilder } from './components/DeckBuilder'
import { GenProgress } from './components/GenProgress'
import { SettingsModal } from './components/SettingsModal'
import { generatedDeckToCod, deckToCod, downloadCod, upsertSavedDeck } from './cod'
import { applyPreset } from './personality'

function initialGeneratorState(settings: AppSettings) {
  const gd = settings.rememberDefaults ? settings.generatorDefaults : defaultGeneratorDefaults()
  return {
    bracket: gd.bracket,
    budget: gd.budget,
    personality: gd.personality,
    profile: gd.profile,
    meta: gd.meta,
    tags: gd.tags,
    options: gd.options,
  }
}

export default function App() {
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const init = initialGeneratorState(appSettings)

  const [view, setView] = useState<'generate' | 'builder'>('generate')
  const [codSaved, setCodSaved] = useState(false)
  const [commander, setCommander] = useState<ScryCard | null>(null)
  const [partner, setPartner] = useState<ScryCard | null>(null)
  const [bracket, setBracket] = useState<1 | 2 | 3 | 4 | 5>(init.bracket)
  const [budget, setBudget] = useState<BudgetTier>(init.budget)
  const [themes, setThemes] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>(init.tags)
  const [options, setOptions] = useState<AdvancedOptions>(init.options)
  const [edhrecThemes, setEdhrecThemes] = useState<EdhrecTheme[]>([])
  const [profile, setProfile] = useState<PowerProfile>(init.profile)
  const [personality, setPersonality] = useState<DeckPersonality>(init.personality)
  const [meta, setMeta] = useState<string[]>(init.meta)
  const [mustInclude, setMustInclude] = useState<ScryCard[]>([])
  const [neverInclude, setNeverInclude] = useState<ScryCard[]>([])

  const [generating, setGenerating] = useState(false)
  const [steps, setSteps] = useState<GenStep[]>([])
  const [liveCards, setLiveCards] = useState<DeckCard[]>([])
  const [deck, setDeck] = useState<Deck | null>(null)

  const [combos, setCombos] = useState<{ included: ComboInfo[]; almost: ComboInfo[] } | null>(null)
  const [combosLoading, setCombosLoading] = useState(false)
  const [upgrades, setUpgrades] = useState<UpgradeTier[]>([])

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const deckRef = useRef<Deck | null>(null)

  useEffect(() => {
    if (!appSettings.rememberDefaults) return
    saveSettings({
      ...appSettings,
      generatorDefaults: {
        bracket,
        budget,
        personality,
        profile,
        meta,
        tags,
        options,
      },
    })
  }, [appSettings, bracket, budget, personality, profile, meta, tags, options])

  useEffect(() => {
    const identity = commander ? unionIdentity(commander, partner) : null
    applyAppAppearance(appSettings, identity)
  }, [appSettings, commander, partner])

  useEffect(() => {
    setAllowUnsetCards(appSettings.allowUnsetCards)
  }, [appSettings.allowUnsetCards])

  const applyPersonalityPreset = (id: Exclude<DeckPersonality, 'custom'>) => {
    const next = applyPreset(id, options)
    setPersonality(id)
    setProfile(next.profile)
    setTags(next.tags)
    setOptions(next.options)
  }

  const handleSettingsSave = (next: AppSettings) => {
    setAppSettings(next)
    saveSettings(next)
  }

  const handleClearData = () => {
    const fresh = loadSettings()
    setAppSettings(fresh)
    const gd = fresh.generatorDefaults
    setBracket(gd.bracket)
    setBudget(gd.budget)
    setPersonality(gd.personality)
    setProfile(gd.profile)
    setMeta(gd.meta)
    setTags(gd.tags)
    setOptions(gd.options)
  }

  const selectCommander = async (card: ScryCard | null) => {
    setCommander(card)
    setPartner(null)
    setThemes([])
    setEdhrecThemes([])
    if (!card) {
      return
    }
    const page = await fetchEdhrecPage(card.name)
    if (page?.themes.length) setEdhrecThemes(page.themes)
  }

  const selectPartner = async (card: ScryCard | null) => {
    setPartner(card)
    if (!commander) return
    if (!card) return
    const a = commanderSlug(commander.name)
    const b = commanderSlug(card.name)
    for (const pairSlug of [`${a}-${b}`, `${b}-${a}`]) {
      const page = await fetchEdhrecPageBySlug(pairSlug)
      if (page?.themes.length) {
        setEdhrecThemes(page.themes)
        setThemes([])
        return
      }
    }
  }

  const expectedPower = (() => {
    const base = { 1: 3.5, 2: 5, 3: 7, 4: 8.5, 5: 9.5 }[bracket]
    return Math.max(1, Math.min(10, base - (budget === 'low' ? 0.5 : 0)))
  })()

  const runGeneration = useCallback(
    async (settings: BuildSettings) => {
      setGenerating(true)
      setCombos(null)
      setUpgrades([])
      setSteps(GEN_STEPS.map((label) => ({ label, status: 'pending' })))
      setLiveCards([])
      try {
        const result = await generateDeck(settings, (stepIndex, cards) => {
          setSteps(
            GEN_STEPS.map((label, i) => ({
              label,
              status: i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'pending',
            }))
          )
          setLiveCards([...cards])
        })
        setSteps(GEN_STEPS.map((label) => ({ label, status: 'done' })))
        setCodSaved(false)
        setDeck(result)
        deckRef.current = result
        setLiveCards(result.cards)
        setCombosLoading(true)
        findCombos(result).then((c) => {
          setCombos(c)
          setCombosLoading(false)
        })
        computeTieredUpgrades(result).then(setUpgrades)
      } finally {
        setGenerating(false)
      }
    },
    []
  )

  const generate = () => {
    if (!commander) return
    setChatMessages([])
    const themeSlugs = themes.map(
      (t) =>
        edhrecThemes.find((e) => e.name === t)?.slug ??
        t.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    )
    runGeneration({
      commander,
      partner,
      bracket,
      budget,
      themes,
      themeSlugs,
      tags,
      options,
      powerProfile: profile,
      personality: personality === 'custom' ? undefined : personality,
      meta,
      mustInclude,
      neverInclude: neverInclude.map((c) => c.name),
    })
  }

  const applyVariant = (kind: VariantKind) => {
    if (!deckRef.current) return
    const s = deckRef.current.settings
    const next: BuildSettings = { ...s, options: { ...s.options } }
    if (kind === 'casual') {
      next.bracket = Math.max(1, s.bracket - 1) as BuildSettings['bracket']
      next.options.avoidCombos = true
      next.options.avoidTutors = true
    }
    if (kind === 'competitive') {
      next.bracket = Math.min(5, s.bracket + 1) as BuildSettings['bracket']
      next.options.avoidCombos = false
      next.options.avoidTutors = false
      next.options.includeStaples = true
    }
    if (kind === 'budget') {
      next.budget = s.budget === 'any' || s.budget === 'high' ? 'mid' : 'low'
    }
    if (kind === 'thematic') {
      next.options.prioritizeSynergy = true
      next.options.includeStaples = false
    }
    setBracket(next.bracket)
    setBudget(next.budget)
    setOptions(next.options)
    runGeneration(next)
  }

  const sendChat = async (text: string) => {
    const current = deckRef.current
    if (!current) return
    setChatMessages((m) => [...m, { role: 'user', text }])
    setChatBusy(true)

    if (llmConfigured(appSettings)) {
      try {
        const reply = await askLlm(current, chatMessages, text, appSettings)
        setChatMessages((m) => [...m, { role: 'assistant', text: reply }])
        setChatBusy(false)
        return
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'LLM request failed'
        setChatMessages((m) => [
          ...m,
          { role: 'assistant', text: `LLM error: ${msg}. Falling back to built-in help.` },
        ])
      }
    }

    await new Promise((r) => setTimeout(r, 350))
    const action = handleChat(current, text)
    setChatMessages((m) => [...m, { role: 'assistant', text: action.text }])
    if (action.type === 'variant') {
      setChatBusy(false)
      applyVariant(action.variant)
      return
    }
    if (action.type === 'budgetSwap') {
      const { deck: newDeck, swapped } = await swapExpensiveCards(current, action.maxPrice)
      setDeck(newDeck)
      deckRef.current = newDeck
      setLiveCards(newDeck.cards)
      setCombosLoading(true)
      findCombos(newDeck).then((c) => {
        setCombos(c)
        setCombosLoading(false)
      })
      computeTieredUpgrades(newDeck).then(setUpgrades)
      setChatMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: swapped.length
            ? `Done. Swapped ${swapped.length} card${swapped.length > 1 ? 's' : ''}: ${swapped
                .map(([from, to]) => `${from} → ${to}`)
                .join('; ')}.`
            : `Nothing in the list is over $${action.maxPrice}, so no swaps were needed.`,
        },
      ])
    }
    setChatBusy(false)
  }

  const startNewBuild = () => {
    setDeck(null)
    deckRef.current = null
    setLiveCards([])
    setCombos(null)
    setUpgrades([])
    setChatMessages([])
    setCodSaved(false)
    setGenerating(false)
    setSteps([])
  }

  const exportCod = async () => {
    if (!deck) return
    const cod = generatedDeckToCod(deck)
    try {
      await downloadCod(cod.name, deckToCod(cod))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      window.alert(message)
    }
  }

  const saveToBuilder = () => {
    if (!deck) return
    const cod = generatedDeckToCod(deck)
    upsertSavedDeck({ name: cod.name, cod })
    setCodSaved(true)
  }

  const statsCards = generating ? liveCards : deck ? deck.cards : []

  return (
    <div className="shell">
      <header className="topnav">
        <h1 className="logo">
          <img src="/icon.png" alt="" /> Galaxy Commander
        </h1>
        <nav className="view-tabs">
          <button
            className={view === 'generate' ? 'active' : ''}
            onClick={() => setView('generate')}
          >
            Generate
          </button>
          <button className={view === 'builder' ? 'active' : ''} onClick={() => setView('builder')}>
            Deck Builder
          </button>
        </nav>
        <button type="button" className="settings-btn" onClick={() => setSettingsOpen(true)}>
          ⚙ Settings
        </button>
      </header>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={appSettings}
        onSave={handleSettingsSave}
        onClearData={handleClearData}
        commanderIdentity={commander ? unionIdentity(commander, partner) : null}
      />
      {view === 'builder' ? (
        <DeckBuilder />
      ) : (
    <div className="app">
      <Sidebar
        commander={commander}
        onCommander={selectCommander}
        partner={partner}
        onPartner={selectPartner}
        bracket={bracket}
        onBracket={setBracket}
        budget={budget}
        onBudget={setBudget}
        themes={themes}
        onThemes={setThemes}
        edhrecThemes={edhrecThemes}
        tags={tags}
        onTags={setTags}
        options={options}
        onOptions={setOptions}
        profile={profile}
        onProfile={setProfile}
        personality={personality}
        onPersonality={setPersonality}
        onApplyPersonality={applyPersonalityPreset}
        meta={meta}
        onMeta={setMeta}
        mustInclude={mustInclude}
        onMustInclude={setMustInclude}
        neverInclude={neverInclude}
        onNeverInclude={setNeverInclude}
        disabled={generating}
      />

      <main className="center">
        {!deck ? (
          <BuilderPanel
            commander={commander}
            partner={partner}
            bracket={bracket}
            budget={budget}
            themes={themes}
            steps={steps}
            generating={generating}
            expectedPower={expectedPower}
            onGenerate={generate}
          />
        ) : (
          <div className="deck-result">
            <div className="center-bar">
              <button type="button" className="new-build" onClick={startNewBuild} disabled={generating}>
                ← New Build
              </button>
              <div className="center-bar-actions">
                <button
                  type="button"
                  className="new-build regenerate"
                  onClick={generate}
                  disabled={generating || !commander}
                >
                  {generating ? 'Generating…' : '↻ Regenerate'}
                </button>
                <button
                  type="button"
                  className="new-build"
                  onClick={() => void exportCod()}
                  disabled={generating}
                >
                  ⬇ Export .cod
                </button>
                <button
                  type="button"
                  className="new-build"
                  onClick={saveToBuilder}
                  disabled={generating || codSaved}
                >
                  {codSaved ? '✓ Saved to Builder' : 'Save to Builder'}
                </button>
              </div>
            </div>
            <div className="deck-result-body">
              {generating && (
                <div className="gen-overlay">
                  <GenProgress steps={steps} />
                </div>
              )}
              <DeckView
                deck={deck}
                combos={combos}
                combosLoading={combosLoading}
                upgrades={upgrades}
                onVariant={applyVariant}
                generating={generating}
                simIterations={appSettings.simIterations}
                disableCardPreviews={appSettings.disableCardPreviews}
              />
            </div>
          </div>
        )}
      </main>

      <aside className="right">
        <StatsPanel cards={statsCards} />
        {deck && !generating && (
          <ChatPanel
            messages={chatMessages}
            onSend={sendChat}
            busy={chatBusy}
            llmActive={llmConfigured(appSettings)}
          />
        )}
      </aside>
    </div>
      )}
    </div>
  )
}
