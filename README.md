# Galaxy Commander

**Play it now in your browser at [commander.thegalaxy.dev](https://commander.thegalaxy.dev).**

A Commander (EDH) deck generator. Pick a commander, set a bracket, budget, themes, and tags, and it assembles a tuned 100-card deck using real data:

- **EDHREC** — per-commander inclusion rates and synergy scores drive card selection; the theme list in the sidebar comes from how the commander is actually built.
- **Scryfall** — commander search, card images, prices, legality, and fallback queries when EDHREC has no data.
- **Commander Spellbook** — detects infinite combos in the generated list, plus "one card away" lines.

## Features

- Partner commander support: generic Partner, "Partner with", Friends Forever, Choose a Background, and Doctor's Companion pairings, with combined color identity and EDHREC pair-page data
- Power Profile sliders: Ramp Priority, Interaction Density, Card Draw Density, Combo Focus, Tutor Density, and Resiliency fine-tune the build within its bracket
- Expected Meta: tell the generator your table skews aggro / midrange / combo / battlecruiser / stax and it packs the matching tech (extra wipes, counterspells, grave hate, artifact hate)
- Card Rules: pin must-include pet cards and ban never-include cards before generating
- Deck Health report on the Overview tab: card draw, interaction, ramp, mana base, curve, commander support, wipe recovery, grave hate, and protection checks with explanations
- Playtest tab: 1,000-hand opening hand simulation (average lands/ramp/draw, mulligan rate, commander cast probability by turn) plus a redrawable sample hand
- Deck Builder tab: build decks by hand with card search, quantity controls, and a commander zone; decks are stored in Cockatrice `.cod` format with import/export, and generated decks can be saved there or exported as `.cod` directly
- Commander search suggests the most-played commanders when focused empty
- Live deck stats (mana curve, card type breakdown, estimated price) that fill in as the deck generates
- Tabbed deck view: Overview, sectioned Decklist (with hover card previews and copy-to-clipboard), Combos, Upgrade Paths, Play Guide
- Deck help chat: ask why a card was included, how to win, about the mana base, or issue commands like "make this more competitive" or "replace all cards over $20"
- One-click variants: More Casual / More Competitive / More Budget / More Thematic
- UI accents themed to the commander's color identity

## Running in the browser

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173. EDHREC requests are routed through a Vite dev proxy (`/edhrec-api`); Scryfall and Commander Spellbook are called directly.

## Desktop app (Tauri)

The app also builds as a native Windows application. Requires the Rust toolchain (rustup, MSVC) and Visual Studio C++ build tools.

```bash
cd app
npm run app:dev     # run the desktop app with hot reload
npm run app:build   # produce installers
```

Installers land in `app/src-tauri/target/release/bundle/` (both an `.msi` and an NSIS `-setup.exe`). In the desktop build, EDHREC is fetched natively through the Tauri HTTP plugin instead of the dev proxy. No API keys are needed in either mode — all data comes from free public APIs (Scryfall, EDHREC, Commander Spellbook) — but an internet connection is required at runtime.

## Smoke test

```bash
cd app
npx tsx smoke-test.mts
```

Generates a full Atraxa deck headlessly and prints category counts, curve, price, duplicate checks, deck health, and opening-hand simulation results. Optional positional args (use `-` to skip one): commander name, comma-separated themes, partner name, a must-include card, and a never-include card, e.g.

```bash
npx tsx smoke-test.mts "Atraxa, Praetors' Voice" Infect - "Sphinx's Tutelage" "Sol Ring"
```

## License

Copyright (C) 2026 Galaxy Development, LLC

Galaxy Commander is free software licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. You may use, study, modify, and redistribute it, but:

- Any redistributed or modified version must remain open source under the same AGPL-3.0 license.
- This applies even if you only run a modified version over a network (e.g. as a hosted web app) — users interacting with it must be able to obtain the corresponding source.
- You must retain this copyright notice and attribution; you may not relicense it or claim it as your own work.

See the [LICENSE](LICENSE) file for the full text.
