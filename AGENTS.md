# AGENTS.md — SB-PICOR Local Operating Contract

Local operating contract for `/home/badi/projects/SB-PICOR`. This workspace exists to develop **SB-PICOR** (SillyBunny Preset Inspector, Cleaner, Optimizer, Repackager) — a deterministic preset adapter, linter, and compiler that solves model incompatibility, prompt cache invalidation, and OOC gagging across the SillyBunny / SillyTavern ecosystem.

Badi approves every external action and public release.

---

## 1. Operating Rules & Core Invariants

1. **Non-Destructive Compilation:** SB-PICOR NEVER overwrites or alters the original master preset. Master presets are source distributions. Repackaging generates a new, character- and model-specific target preset (e.g. `Geechan v5.3 [Alice • Claude 3.7 Edition]`).
2. **The "OOC Diagnostic Isolation" Invariant:** Diagnostic or meta-query turns (e.g., asking why a character is looping or broken) MUST NEVER include character persona, system jailbreaks, or negative constraints in the diagnostic prompt payload. Diagnostic calls run in a clean, neutral system context to prevent the "OOC Gag Trap".
3. **Cache-First Prompt Architecture:** Every compiled target preset must preserve prompt cache boundaries:
   - Top prefix must remain 100% byte-stable (static system rules, core formatting).
   - Dynamic injection variables (`{{time}}`, `{{random}}`, low-depth prompts) must be positioned *after* the static prefix.
4. **Provider Grammar Discipline:**
   - **Anthropic:** Prefers structured XML tags (`<guidelines>`, `<dialogue_style>`). Convert negative constraints into positive behavioral boundaries where possible.
   - **OpenAI:** Prefers Markdown headings (`# Instructions`, `## Rules`) and concise bullet points. Enforce `developer` role compatibility and strip all samplers (`temperature`, `top_p`, penalties) on `o1`/`o3` targets.
   - **Google:** High-contrast, unified system instruction. Strip legacy samplers (`typical_p`, `min_p`, `top_a`).
   - **DeepSeek:** Minimalist system framing for R1; moderate temperature (0.6–0.7) and conservative penalties for V3.
   - **Local / Ollama:** Strip deprecated samplers (`typical_p`, per SillyTavern #6044), guard context ceilings.
5. **Deterministic Schema Contract:** When an LLM is used in Phase 3 (Optimize), it must operate strictly against a validated JSON output schema. Free-form, conversational, or hallucinated markdown recommendations are rejected.
6. **Identity Lane:** Public pushes and PRs go through GitHub identity `cspiritsong`. Local daily operations default to `badiyee85`.

---

## 2. Model Routing for Development

Per Badi's universal model routing standard:
- **Operator / Reconnaissance (Default — Gemini 3.8 Flash via SmolProxy):** Owns procedure, repository reconnaissance, AST parsing scripts, JSON schemas, test runner execution, and mechanical transformations.
- **Engineer (Claude Opus 5 via xkiro @ max):** Owns architectural design, cross-provider grammar mapping, state machine logic, and prompt compilation rulesets.
- **Adversary (Fresh Claude Opus 5 context via xkiro @ max):** Reviews compiler output diffs, checks for semantic loss between master and compiled presets, and tests edge cases.

---

## 3. Directory & Artifact Structure

- `PROJECT.md` — Project mission, topography, and repo map.
- `PLAN.md` — Live execution ledger, current checkpoints, and next immediate actions.
- `AGENTS.md` — This operating contract and hard rules.
- `discussions/` — Historical discussions, transcripts, and decision logs.
- `intel/presets/` — Mined community presets (Geechan, Mother Midnight, Freaky Frankenstein, etc.).
- `src/` — Core parser, linter, provider compilers, and extension code.

---

## 4. Verification Standards

- **Static Linter Efficacy:** Proves 100% detection rate of incompatible samplers against a mock model capability database.
- **Semantic Preservation:** Optimizing and repackaging a preset must not drop critical character lore, trigger words, or user formatting preferences.
- **Cache Hit Verification:** Measure simulated or real prompt prefix byte stability across turns.
- **Zero-Error Node/ESM Execution:** All scripts must run clean under Node.js ESM (`node --check`).

---

## 5. Learned Rules (append-only)

- **2026-09-16:** Workspace initialized. Target: SillyBunny / SillyTavern preset bloat and model incompatibility.
- **2026-09-16:** Discovered and codified the "OOC Gag Trap": negative constraints in character cards and master presets gag the model when users attempt OOC troubleshooting. Diagnostic engine must execute in an isolated meta-lane.
- **2026-09-16:** Geechan Universal v5.3 (Meip's Tinker v3) ingested into `intel/presets/` as the primary benchmark artifact (54 prompt blocks, ~4,200 tokens).
