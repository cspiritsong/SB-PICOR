# SB-PICOR: SillyBunny Preset Inspector, Cleaner, Optimizer, Repackager

**SB-PICOR** is an intelligent preset compiler and adapter for the SillyBunny / SillyTavern ecosystem. It takes massive, monolithic "Universal" community presets (e.g. *Geechan*, *Mother Midnight*, *Freaky Frankenstein*) and deterministically inspects, cleans, optimizes, and compiles them into lean, model- and character-tailored presets.

---

## The Problem

Community presets attempt to be "universal" by packing 50+ system prompts, dense negative constraints, anti-refusal layers, and exotic samplers into a single 4,000+ token JSON.

When users pair these presets with different models or character cards:
1. **API Crashes (HTTP 400):** Models like OpenAI o1/o3-mini, modern Ollama, and Claude-with-thinking reject parameters like `temperature`, `typical_p`, `top_p`, and penalty flags.
2. **The "OOC Gag Trap":** Presets and cards command the AI to *"Never break character"* or *"Never speak for user"*. When the user types an Out-Of-Character (OOC) query to fix a glitch, the model is gagged by its own context window and loops, stammers, or refuses.
3. **Prompt Cache Invalidation:** Dynamic variables (`{{time}}`) placed high in the preset bust the prefix cache on Anthropic and DeepSeek, increasing API latency and costs by up to 800%.

---

## The Solution: 4-Stage Preset Compilation

```text
┌────────────────────────┐
│  Master "Universal"    │ (4,200 tokens, 54 prompts, competing rules)
│      Preset JSON       │
└───────────┬────────────┘
            ▼
┌────────────────────────┐
│ 1. INSPECT (0 tokens)  │ Static AST scan of samplers, disabled toggles, cache breaks
└───────────┬────────────┘
            ▼
┌────────────────────────┐
│ 2. CLEAN & LINT        │ Deduplicate negative constraints; detect Card vs Preset clashes
└───────────┬────────────┘
            ▼
┌────────────────────────┐
│ 3. OPTIMIZE (Compiler) │ Target-specific prompt grammars (Anthropic XML, OpenAI Markdown)
└───────────┬────────────┘
            ▼
┌────────────────────────┐
│ 4. REPACKAGE           │ Lean, character+model-locked preset (750 tokens, 0 crashes)
│                        │ Master preset remains completely untouched!
└────────────────────────┘
```

---

## Directory Structure

- `PROJECT.md` — Project mission, architecture, and repo map.
- `AGENTS.md` — Agent operating contract, rules, and provider invariants.
- `PLAN.md` — Live execution ledger and phase checkpoints.
- `intel/presets/` — Mined community reference presets.
- `src/` — Core compiler, linter, provider targets, and extension frontend.
- `discussions/` — Historical transcripts and architectural decisions.
