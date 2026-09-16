# SB-PICOR: Preset & Card Doctor

**SB-PICOR** (SillyBunny Preset Inspector, Cleaner, Optimizer, Repackager) is a standalone extension for SillyBunny and SillyTavern. It provides deterministic, line-precise diagnostics and compilation across presets, character cards, and LLM backends.

---

## Problems Solved

1. **The OOC Gag Trap:** Character cards and post-history prompts often mandate `"Never break character or acknowledge being an AI"`. When a user asks an Out-Of-Character troubleshooting question (`[OOC: Why are you looping?]`), the model is gagged by its own context and refuses or breaks.
2. **Model Wire Crashes (HTTP 400):** Modern backends reject legacy samplers. OpenAI o1/o3 reject `temperature`, `top_p`, and penalties; modern Ollama rejects `typical_p`; Grok rejects penalties.
3. **Monolithic Preset Bloat:** Community presets bundle 40+ dead drafts, visual dividers (`🌱 ━+ Enable ONE`), and user manuals inside the JSON, wasting thousands of context tokens.
4. **Prompt Cache Busted:** Dynamic macros (`{{time}}`, `{{random}}`) placed high in system blocks break prefix caching on Claude and DeepSeek on every swipe.

---

## Core Capabilities

### 1. In-Chat Doctor Agent (Structural Immunity)
Runs as a SillyBunny In-Chat Agent (ICA) companion with `includeSystemPrompt: false` and `includePersona: false`. Because character cards and system jailbreaks are physically excluded from its context, the Doctor is structurally immune to the OOC Gag Trap.

### 2. Line-Number Precise Source Indexer
Indexes text across all 7 card fields (`description`, `personality`, `scenario`, `post_history_instructions`, `system_prompt`, `mes_example`, `creator_notes`) and preset prompt blocks. Reports exact 1-indexed line numbers, field names, and content hashes.

### 3. Two-Phase Mutation Engine & Reversibility
- **Anchor Drift Protection (Invariant I2):** Refuses writes if field text shifted between scan and execution (`hash !== expectedHash`).
- **Transaction Journaling (Invariant I3):** Records pre-image snapshots before every write; fully reversible via `undoLast()`.
- **FixToken Security (Invariant I4):** Fixes require an analyzer-minted cryptographic token to execute. LLMs can only name fixes, never author arbitrary writes.

### 4. Provider Compiler Matrix
Compiles presets into target-specific grammars:
- **Anthropic:** Formats into `<story_guidelines>` and `<dialogue_rules>` XML tags, preserves top-prefix byte stability for prompt caching, and injects the OOC exemption bridge.
- **OpenAI:** Markdown headings (`# Instructions`), developer role, strips all samplers on o1/o3, maps `max_completion_tokens`.
- **Google:** Consolidated system instructions, non-standard sampler removal.
- **DeepSeek:** Minimalist prompt framing for R1 (anti-jailbreak degradation), safe penalty ceilings for V3.
- **Local (Ollama):** Strips deprecated `typical_p`, prevents context window overflow.

---

## Installation

### Via Extension Manager (Recommended)
1. In SillyBunny or SillyTavern, open **Extensions** (cube icon) -> **Install Extension**.
2. Paste the Git URL:
   ```text
   https://github.com/cspiritsong/SB-PICOR
   ```
3. Click **Save** and refresh your browser.

### Manual Install
Clone into your extensions folder:
```bash
cd SillyBunny/public/scripts/extensions/third-party
git clone https://github.com/cspiritsong/SB-PICOR.git
```

---

## Usage

- **UI Button:** Click the **`🩺 Doctor`** button in the top navigation bar.
- **Slash Commands:** Run `/doctor` or `/picor` in chat.
- **Automatic Intercept:** Type a diagnostic query in chat:
  ```text
  [OOC: Why are you looping on this response?]
  ```
  The interceptor catches the query, suppresses character generation, and opens the Doctor's diagnostic card.

---

## Diagnostic Output Format

The Doctor outputs exact, actionable cards:

```text
⚠️ OOC Gag Trap Detected
  Location: Character Card ("Alice") -> [Post-History Instructions] : Line 3
  Snippet:  "Under no circumstances break character or acknowledge being an AI."
  Reason:   This line forbids the model from responding to meta/debug queries.
  Action:   [ ✂️ Mute Line 3 in Alice ]

❌ Unsupported Wire Parameter
  Location:  Preset ("Freaky Frankenstein") -> Samplers
  Parameter: typical_p = 0.95 (Target: Ollama)
  Reason:    Ollama deprecated and removed typical_p; requests will fail with HTTP 400.
  Action:    [ ⚡ Strip typical_p ]
```

---

## Repository Layout

```text
SB-PICOR/
├── manifest.json              # Extension metadata and hooks
├── index.js                   # UI triggers, slash commands, modal renderer
├── style.css                  # Diagnostic card styles
├── src/
│   ├── ast/
│   │   ├── inventory.js       # Preset parser, token weight calculator
│   │   └── source-indexer.js  # 1-indexed multi-field line indexer with content hashing
│   ├── linter/
│   │   ├── wire-audit.js      # Target model compatibility checker
│   │   ├── card-audit.js      # Line-numbered card and OOC gag detector
│   │   ├── arrangement-audit.js # Sequence and cache boundary checker
│   │   └── model-caps.json    # Backend parameter capabilities database
│   ├── mutate/
│   │   └── tx.js              # Two-phase transaction journal, FixTokens, reversibility
│   ├── targets/
│   │   └── matrix.js          # Provider compiler matrix (Anthropic, OpenAI, DeepSeek, Local)
│   ├── cleaner/
│   │   └── prune.js           # Dead prompt and divider pruning engine
│   └── repackager/
│       └── compile.js         # Tailored preset packager
├── templates/
│   └── tpl-sb-picor-doctor.json # Official In-Chat Agent template
└── tests/
    ├── sb-picor.test.js       # Core 5-milestone test suite (17/17 pass)
    └── alpha2.test.js         # Invariant & transaction test suite (29/29 pass)
```

---

## Verification & Tests

Run the test suite locally with Node.js:
```bash
node tests/sb-picor.test.js
node tests/alpha2.test.js
```
Total: **46/46 automated assertions passing**.

---

## License

MIT © [cspiritsong](https://github.com/cspiritsong)
