# Discussion 01: SB-PICOR Origins & Architecture

**Date:** 2026-09-16  
**Session ID:** `@session:default/20260916_132812_e5d7ea`  
**Participants:** Badi, Bobby (Gemini 3.8 Flash via SmolProxy)  
**Topic:** The "Monolithic Preset" Problem, The OOC Gag Trap, and the 4-Phase Compiler Architecture  

---

## 1. Context & Motivation

During discussion on upstream SillyBunny/SillyTavern issues (specifically issue #6044 regarding Ollama rejecting `typical_p` and #6000 regarding connection profiles), Badi presented a deeper architectural challenge in the community roleplay ecosystem:

Users frequently download massive community presets such as **Geechan Universal v5.3**, **Mother Midnight**, or **Freaky Frankenstein**. These presets contain 40–60 prompt toggles, complex system instructions, anti-refusals, and rigid sampler configurations. When users import them:
1. They switch models (e.g., to OpenAI o1/o3-mini, Claude 3.5/3.7, DeepSeek, or Ollama) and generation crashes with HTTP 400 errors because providers reject specific parameters.
2. They pair these presets with poorly constructed or opinionated character cards containing conflicting instructions.
3. The prompt becomes a contradictory soup. When users try to troubleshoot via Out-Of-Character (OOC) chat, the model cannot help.

---

## 2. The Core Insights

### A. The "OOC Gag Trap"
Badi identified the core symptom:
> *"When I go OOC chat with the card, the card says 'well there's an instruction somewhere' and the card can't point out because every time OOC chat happens the instructions are sent before the OOC, and so it becomes part of the chain, and the LLM can't answer because the instruction already says 'no do not write for xxx / user'..."*

**Root Cause:** In SillyBunny / SillyTavern, an OOC message is simply appended to the bottom of the active conversation. The model receives all 54 system blocks, all character jailbreaks, and negative constraints ("Never break character", "Never acknowledge being an AI", "Never speak for user") *above* the user's OOC message. The model is literally gagged by its own context window.

**Resolution in SB-PICOR:** Diagnostic turns must run in an **isolated meta-lane** with zero character persona, zero system jailbreaks, and zero negative constraints.

### B. The Monolithic Preset as "Source Code"
Massive presets are built by authors attempting to be "Universal". Instead of fighting preset authors or breaking their presets:
- Treat Master Presets like **source code**.
- SB-PICOR acts like an **optimizing compiler (LLVM)** that compiles the source preset into a target runtime binary: a lean, character- and model-specific preset (e.g. `Geechan v5.3 [Alice • Claude 3.7 Edition]`).
- The original master preset remains completely intact and untouched.

---

## 3. Empirical AST Reconnaissance: Geechan v5.3 Ingestion

Static analysis of `intel/presets/geechan-universal-v5.3-tinker-v3.json` revealed shocking empirical proof of the "Preset Bloat" pathology:
- **Total defined prompts in JSON:** **54 prompt blocks** (223,020 characters / ~55,755 tokens of text).
- **Revision Control Abuse:** Preset authors literally use the SillyTavern prompt list as a Git commit history and manual menu. For example, Order 1 contains:
  - `NSFW Meip's Foolery v0.5 (old)` (8,257 chars, DISABLED)
  - `NSFW Meip's Foolery v1` through `v5` (each ~7,200 chars, DISABLED)
  - `🌳 README` (5,320 chars, DISABLED)
  - `🌿 Sampling Advice` (2,029 chars, DISABLED)
  - `🌱 ━+ Enable ONE` (0 chars, used as a UI category divider label!)
- **Active Payload:** Out of 53 entries in Order 1, only **3 prompts are actually active** (8,668 chars / ~2,167 tokens). The other 50 are dead revisions, manuals, and comment dividers.
- **Wire Incompatibilities:** Top-level config forces `temperature: 1`, `top_p: 0.99`, `repetition_penalty: 1`, and `reasoning_effort: max`. Dispatched to an OpenAI o3-mini or Ollama endpoint, this payload will immediately HTTP 400.

---

## 4. The 4-Stage SB-PICOR Pipeline

1. **Inspect (0 tokens / Static AST):**
   - Parses the preset JSON.
   - Evaluates active vs. inactive prompt blocks.
   - Audits samplers against the target model wire-compatibility matrix (e.g., stripping `temperature` on o3-mini, `typical_p` on Ollama).
   - Audits cache boundaries: identifies dynamic macros (`{{time}}`) placed above static instructions that break Anthropic/DeepSeek prompt caching.
2. **Clean (Constraint Linter):**
   - Counts and deduplicates negative constraints ("Never do X").
   - Cross-checks Character Card fields against Preset rules to find direct contradictions (e.g. Victorian prose vs. street slang).
3. **Optimize (Target-Specific Prompt Compiler):**
   - Translates general instructions into target provider grammar:
     - **Anthropic:** Clean XML structure (`<guidelines>`, `<dialogue_style>`), positive framing.
     - **OpenAI:** Markdown headings, `developer` role, sampler removal for o-series.
     - **Google:** Consolidated high-contrast system instructions.
     - **DeepSeek:** Minimalist system framing for R1; safe penalty ceilings for V3.
4. **Repackage:**
   - Compiles and exports a lightweight, tailored preset.
   - Cuts token weight by 70–85% (from ~4,200 tokens down to ~750 tokens).
   - Binds the compiled preset to the specific character and model.

---

## 5. Immediate Decisions & Next Steps

- Project name officially established: **SB-PICOR** (SillyBunny Preset Inspector, Cleaner, Optimizer, Repackager).
- Workspace initialized at `/home/badi/projects/SB-PICOR`.
- Benchmark artifact: Geechan Universal Roleplay v5.3 (Meip's Tinker v3) stored in `intel/presets/`.
- Next step: Build the Phase 2 AST linter engine in `src/ast/`.
