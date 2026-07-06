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
import { GEN_STEPS, computeTieredUpgrades, deckFromCards, generateDeck, swapExpensiveCards } from './generator'
import { findCombos } from './combos'
import { commanderSlug, fetchEdhrecPage, fetchEdhrecPageBySlug, type EdhrecTheme } from './edhrec'
import { unionIdentity } from './partner'
import { setAllowUnsetCards, setNoSpoilers } from './scryfall'
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
import { PackSimulator } from './components/PackSimulator'
import { GenProgress } from './components/GenProgress'
import { SettingsModal } from './components/SettingsModal'
import { generatedDeckToCod, deckToCod, downloadCod, downloadText, upsertSavedDeck, type CodDeck } from './cod'
import { buildShareUrl, clearShareParam, createPermalink, readSharedDeckFromUrl, shareLinkExpired } from './share'
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
  const [discordPromptOpen, setDiscordPromptOpen] = useState(() => {
    try {
      return localStorage.getItem('gc-discord-announce-v1') !== '1'
    } catch {
      return false
    }
  })
  const dismissDiscordPrompt = () => {
    try {
      localStorage.setItem('gc-discord-announce-v1', '1')
    } catch {
      /* ignore */
    }
    setDiscordPromptOpen(false)
  }
  const init = initialGeneratorState(appSettings)

  const [sharedDeck] = useState<CodDeck | null>(() => readSharedDeckFromUrl())
  const [view, setView] = useState<'generate' | 'builder' | 'packs'>(
    sharedDeck ? 'builder' : 'generate'
  )
  const [builderSeed, setBuilderSeed] = useState<CodDeck | null>(null)

  useEffect(() => {
    if (sharedDeck) clearShareParam()
    else if (shareLinkExpired()) {
      window.setTimeout(
        () => window.alert('That shared deck link has expired or no longer exists.'),
        0
      )
    }
  }, [sharedDeck])
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

  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState(false)
  const [permaBusy, setPermaBusy] = useState(false)
  const [permaFlash, setPermaFlash] = useState(false)
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
    setAllowUnsetCards(options.allowUnsetCards)
    setNoSpoilers(options.noSpoilers)
  }, [options.allowUnsetCards, options.noSpoilers])

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
        void fetch('/api/generated', { method: 'POST' }).catch(() => {})
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
      budgetCaps: appSettings.budgetCaps,
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

  const analyzeBuiltDeck = (
    commanderCard: ScryCard,
    partnerCard: ScryCard | null,
    cards: DeckCard[],
    name: string
  ) => {
    const built = deckFromCards(commanderCard, partnerCard, cards, name)
    setCommander(commanderCard)
    setPartner(partnerCard)
    setChatMessages([])
    setCodSaved(true)
    setDeck(built)
    deckRef.current = built
    setLiveCards(built.cards)
    setCombos(null)
    setUpgrades([])
    setView('generate')
    setCombosLoading(true)
    findCombos(built).then((c) => {
      setCombos(c)
      setCombosLoading(false)
    })
    computeTieredUpgrades(built).then(setUpgrades)
  }

  const improveBuiltDeck = async (
    commanderCard: ScryCard,
    partnerCard: ScryCard | null,
    cards: ScryCard[]
  ) => {
    setDeck(null)
    deckRef.current = null
    setSteps([])
    setGenerating(false)
    setCommander(commanderCard)
    setPartner(partnerCard)
    setThemes([])
    setEdhrecThemes([])
    setMustInclude(cards)
    setView('generate')
    let page = null
    if (partnerCard) {
      const a = commanderSlug(commanderCard.name)
      const b = commanderSlug(partnerCard.name)
      for (const pairSlug of [`${a}-${b}`, `${b}-${a}`]) {
        page = await fetchEdhrecPageBySlug(pairSlug)
        if (page?.themes.length) break
      }
    }
    if (!page?.themes.length) page = await fetchEdhrecPage(commanderCard.name)
    if (page?.themes.length) setEdhrecThemes(page.themes)
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

  const exportText = async () => {
    if (!deck) return
    try {
      await downloadText(generatedDeckToCod(deck).name, deck)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      window.alert(message)
    }
  }

  const shareDeck = async () => {
    if (!deck) return
    const url = buildShareUrl(generatedDeckToCod(deck))
    if (url.length > 8000) {
      window.alert(
        'This deck is too large to share as a link. Export it as .txt or .cod instead.'
      )
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setShared(true)
      window.setTimeout(() => setShared(false), 1500)
    } catch {
      window.prompt('Copy this shareable link:', url)
    }
  }

  const permalinkDeck = async () => {
    if (!deck || permaBusy) return
    setPermaBusy(true)
    try {
      const url = await createPermalink(generatedDeckToCod(deck))
      try {
        await navigator.clipboard.writeText(url)
        setPermaFlash(true)
        window.setTimeout(() => setPermaFlash(false), 1500)
      } catch {
        window.prompt('Copy this permanent link:', url)
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not create a permanent link.')
    } finally {
      setPermaBusy(false)
    }
  }

  const copyList = async () => {
    if (!deck) return
    const text = deck.cards.map((d) => `${d.qty} ${d.card.name}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      window.alert('Could not access the clipboard.')
    }
  }

  const saveToBuilder = () => {
    if (!deck) return
    const cod = generatedDeckToCod(deck)
    upsertSavedDeck({ name: cod.name, cod })
    setCodSaved(true)
  }

  const openPackPullsInBuilder = (cod: CodDeck) => {
    setBuilderSeed(cod)
    setView('builder')
  }

  const generateForOpenedCommander = (card: ScryCard) => {
    startNewBuild()
    void selectCommander(card)
    setView('generate')
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
          <button className={view === 'packs' ? 'active' : ''} onClick={() => setView('packs')}>
            Pack Simulator
          </button>
        </nav>
        <div className="topnav-actions">
          <a
            className="github-btn discord-btn"
            href="https://discord.gg/5nmag9c95s"
            target="_blank"
            rel="noopener noreferrer"
            title="Join the Discord"
            aria-label="Join the Discord"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
              />
            </svg>
          </a>
          <a
            className="github-btn"
            href="https://github.com/thegalaxydev/GalaxyCommander"
            target="_blank"
            rel="noopener noreferrer"
            title="View source on GitHub"
            aria-label="View source on GitHub"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
              />
            </svg>
          </a>
          <button type="button" className="settings-btn" onClick={() => setSettingsOpen(true)}>
            ⚙ Settings
          </button>
        </div>
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
        <DeckBuilder
          onAnalyze={analyzeBuiltDeck}
          onImprove={improveBuiltDeck}
          initialDeck={builderSeed ?? sharedDeck}
        />
      ) : view === 'packs' ? (
        <PackSimulator
          onOpenInBuilder={openPackPullsInBuilder}
          onGenerateFor={generateForOpenedCommander}
          disableCardPreviews={appSettings.disableCardPreviews}
        />
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
        budgetCaps={appSettings.budgetCaps}
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
                  onClick={() => void exportText()}
                  disabled={generating}
                >
                  ⬇ Export .txt
                </button>
                <button
                  type="button"
                  className="new-build"
                  onClick={() => void copyList()}
                  disabled={generating}
                >
                  {copied ? '✓ Copied' : '⧉ Copy to Clipboard'}
                </button>
                <button
                  type="button"
                  className="new-build"
                  onClick={() => void shareDeck()}
                  disabled={generating}
                  title="Copy a shareable link that reconstructs this deck — no account or upload needed"
                >
                  {shared ? '✓ Link copied' : '🔗 Share link'}
                </button>
                <button
                  type="button"
                  className="new-build"
                  onClick={() => void permalinkDeck()}
                  disabled={generating || permaBusy}
                  title="Save a short permanent link (e.g. /d/abc123). Stored for 90 days, refreshed whenever it's opened"
                >
                  {permaFlash ? '✓ Permalink copied' : permaBusy ? 'Saving…' : '♾ Permalink'}
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
                settings={appSettings}
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
      {discordPromptOpen && (
        <div className="modal-backdrop" onClick={dismissDiscordPrompt}>
          <div className="modal discord-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={dismissDiscordPrompt}>
              ×
            </button>
            <div className="discord-modal-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="40" height="40">
                <path
                  fill="currentColor"
                  d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
                />
              </svg>
            </div>
            <h2>Galaxy Commander has a Discord!</h2>
            <p>
              Join the community to share decks, suggest features, report bugs, and try the new deck
              generator bot. Hope to see you there!
            </p>
            <div className="discord-modal-actions">
              <a
                className="discord-join-btn"
                href="https://discord.gg/5nmag9c95s"
                target="_blank"
                rel="noopener noreferrer"
                onClick={dismissDiscordPrompt}
              >
                Join the Discord
              </a>
              <button type="button" className="discord-dismiss-btn" onClick={dismissDiscordPrompt}>
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
      <span className="version-badge">v{__APP_VERSION__}</span>
    </div>
  )
}
