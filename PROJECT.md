# PROJECT.md — SB-PICOR (SillyBunny Preset Inspector, Cleaner, Optimizer, Repackager)

**Workspace Location:** `/home/badi/projects/SB-PICOR`  
**Aliases:** `~/projects/SB-PICOR`, `~/SB-PICOR`, `~/projects/sb-picor`  
**Coordinator & Executor:** Bobby/default  
**Principal:** Badi  

---

## 1. Executive Summary

**SB-PICOR** (SillyBunny Preset Inspector, Cleaner, Optimizer, Repackager) is a specialized tool and SillyBunny/SillyTavern extension that solves the **"Monolithic Preset" problem**.

Community power-presets (e.g. *Geechan Universal*, *Mother Midnight*, *Freaky Frankenstein*, *Pura Director*) are engineered as monolithic kitchen-sink files bundling 40–60 prompt blocks, heavy negative constraint chains, anti-refusals, and tuned samplers. When users import these presets and switch models (e.g. Claude to o3-mini to DeepSeek) or pair them with opinionated character cards, three compounding failures occur:
1. **Model Wire Crashes (HTTP 400):** Providers like OpenAI o-series reject `temperature`/`top_p`/penalties; modern Ollama rejects `typical_p`; Claude rejects temperature when thinking is enabled.
2. **The "OOC Gag Trap":** Negative constraints in the preset and card (e.g., *"Never break character"*, *"Never speak for {{user}}"*) gag the LLM during Out-Of-Character (OOC) troubleshooting, causing loops, cryptic stammering, and refusal.
3. **Cache Inefficiency & Token Bloat:** Dynamic variables (`{{time}}`, low-depth injections) placed high in system blocks break prefix caching across Anthropic, DeepSeek, and OpenAI, inflating API costs by 300–800% and burning 4,000+ context tokens per turn.

SB-PICOR operates like an **LLVM compiler for LLM Presets**:
- **Source:** Master "Universal" Preset JSON.
- **Inspect (0 tokens):** Static AST scan of active toggles, token weight, sampler compatibility, and cache boundaries.
- **Clean:** Deduplicate overlapping negative constraints and flag collisions between Card and Preset.
- **Optimize (Deterministic Agent Pass):** Transform instructions into target-specific provider prompt grammars (Anthropic XML, OpenAI Markdown/Developer role, Google SystemInstruction, DeepSeek clean).
- **Repackage:** Compile a lean, character- and model-tailored preset (`Geechan v5.3 [Alice • Claude 3.7 Edition]`, ~750 tokens vs 4,200 tokens) without modifying the original master preset.

---

## 2. Repositories and GitHub Identity Lanes

| Role | Repository / Remote | GitHub Account | Credential / Protocol |
| :--- | :--- | :--- | :--- |
| **Upstream Target** | `SillyBunnyTeam/SillyBunny` / Extension Ecosystem | N/A (read-only) | Read-only |
| **Canonical Repo** | `cspiritsong/SB-PICOR` (or `sillybunny-picor`) | `cspiritsong` | `GITHUB_CSPIRITSONG_TOKEN` |
| **Daily Operations** | N/A | `badiyee85` | Default `gh` account |

*Per Badi's standing identity rule: SillyTavern / SillyBunny ecosystem tooling belongs strictly to the `cspiritsong` lane.*

---

## 3. Test Harness & Topography

1. **Local Linux Host (Canonical Dev):**
   - Node.js ESM environment, testing fixtures, static AST scanner, schema validator.
2. **SillyBunny Baseline / Canary (Port 4444 / 4445):**
   - Extension integration testing against live SillyBunny runtime.
3. **Provider Testbeds:**
   - OpenAI-compatible endpoints, Anthropic Claude endpoints, Google Gemini, Ollama local instance.

---

## 4. Workspace Directory Layout

```text
~/projects/SB-PICOR/
├── AGENTS.md                 # Agent operating contract, rules, and provider grammar invariants
├── PROJECT.md                # Project mission, architecture, and repo map
├── PLAN.md                   # Live execution ledger & phase checkpoints
├── README.md                 # Project overview and usage guide
├── .gitignore                # Hygiene and ignore rules
├── intel/                    # Presets, analysis dumps, and research
│   └── presets/              # Raw community presets (Geechan, Frankenstein, etc.)
├── src/                      # Core logic
│   ├── ast/                  # Preset parser, tokenizer, and schema extractor
│   ├── linter/               # Conflict detector and sampler compatibility checker
│   ├── targets/              # Provider-specific compilers (anthropic, openai, google, deepseek)
│   └── extension/            # SillyBunny / SillyTavern UI plugin harness
└── discussions/              # Historical discussions, transcripts, and decisions
    ├── INDEX.md              # Sessions master table
    ├── 01-sb-picor-origins-and-architecture.md
    └── sessions.json         # Machine-readable session registry
```

---

## 5. Active Deliverables & Status

- **Current Milestone:** Phase 1 — Project Initialization & Preset Intake.
- **Test Artifact on Disk:** `intel/presets/geechan-universal-v5.3-tinker-v3.json` (analyzed).
