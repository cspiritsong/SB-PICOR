# PLAN.md — SB-PICOR Execution Ledger

**Current Status:** Milestone 1 & 2 Intake & Architecture  
**Active Lead:** Bobby/default  
**Workspace:** `/home/badi/projects/SB-PICOR`  

---

## 1. The 5-Milestone Roadmap

```text
[M1: Presence & Inventory]  ──► Inspect that preset & prompts exist; parse true structure
       │
[M2: Wire & Anomaly Check]  ──► Catch illegal/unsupported model params & weird card instructions
       │
[M3: Arrangement & Order]   ──► Validate sequence (system vs card vs post-history vs cache prefix)
       │
[M4: Surgical Cleanup]      ──► Prune dead revisions, dividers, READMEs, duplicate constraints
       │
[M5: Package Optimization]  ──► Compile lean, tailored, card+model-locked runtime preset
```

---

## 2. Milestone Breakdown

### Milestone 1: Inspect that Preset / Prompts Exist (Presence & Inventory)
*Goal: Know what is actually loaded without guessing or being fooled by visual UI tricks.*
- [x] Ingest benchmark artifact: Geechan Universal v5.3 (Meip's Tinker v3).
- [ ] Build `src/ast/inventory.js`: Parse preset JSON, resolve active `prompt_order` (global `100000` vs custom orders), count enabled vs disabled prompts, and measure true token weights.
- [ ] Extract UI display hierarchy matching SillyTavern / SillyBunny prompt inspector expectations.

### Milestone 2: Inspect that Nothing Weird is Going On (Anomalies & Incompatibilities)
*Goal: Catch wire crashes and contradictory card instructions before generation starts.*
- [ ] **Wire Compatibility Checker (`src/linter/wire-audit.js`):**
  - Compare preset samplers against target model rules:
    - OpenAI o1/o3: reject `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`.
    - Modern Ollama: reject `typical_p` (SillyTavern #6044).
    - Claude with Thinking: reject temperature override or non-1.0 values.
    - Grok / xAI: reject `presence_penalty` / `frequency_penalty`.
- [ ] **Weird Card Instructions & Negative Constraint Audit (`src/linter/card-audit.js`):**
  - Scan character card description, scenario, and post-history for conflicting directives.
  - Detect the "OOC Gag Trap": commands like *"Never speak as AI"*, *"Under no circumstances break character"*, *"Never speak for user"*.
  - Flag direct clashes between card instructions and preset rules.

### Milestone 3: Inspect that the Arrangement is Correct (Sequence & Cache Alignment)
*Goal: Ensure instructions sit where models expect them and prompt caches stay warm.*
- [ ] **Sequence Verification (`src/linter/arrangement-audit.js`):**
  - Verify that post-history instructions aren't wrongly injected at the front.
  - Verify that foundational character identity isn't buried at the bottom.
  - Detect role misuse (`system` vs `user` vs `assistant` vs `developer`).
- [ ] **Cache Boundary Analysis:**
  - Verify that the top system prefix is 100% byte-stable.
  - Flag dynamic macros (`{{time}}`, `{{random}}`, low-depth injections) that sit above static system prompts and bust Anthropic/DeepSeek prefix caching.

### Milestone 4: Can a Cleanup Occur? (Surgical Pruning)
*Goal: Safely strip dead weight without touching the original master preset.*
- [ ] **Dead Weight Pruner (`src/cleaner/prune.js`):**
  - Strip disabled revision history (`NSFW Meip's Foolery v0.5...v5`).
  - Strip UI comment dividers (`🌱 ━+ Enable ONE`, `=+=+=+=`).
  - Strip documentation prompts (`🌳 README`, `🌿 Sampling Advice`).
  - Deduplicate repeated negative constraints.
  - Strip model-illegal sampler keys for the active connection.

### Milestone 5: Can Optimizing Occur as a Package? (Tailored Compilation)
*Goal: Compile a lean, card+model-locked runtime preset.*
- [ ] **Target Compilers (`src/targets/`):**
  - `anthropic.js`: Format into structured XML tags (`<guidelines>`, `<dialogue_style>`), reframe negative constraints into positive boundaries, lock cache prefix.
  - `openai.js`: Format into Markdown headings (`# Instructions`), developer role, strip samplers for o-series.
  - `google.js`: Unified high-contrast system instruction.
  - `deepseek.js`: Minimalist system framing for R1; safe penalty ceilings for V3.
  - `local.js`: Ollama / vLLM clean sampler profile.
- [ ] **Repackager & Exporter (`src/repackager/export.js`):**
  - Export tailored preset: `[Original Name] [Character • Model Edition].json`.
  - Non-destructive: leaves the master preset 100% intact.
  - Token reduction target: 70–85% reduction in system prompt overhead.

---

## 3. Next Immediate Actions

1. Implement **Milestone 1**: Build `src/ast/inventory.js` to parse any preset JSON and produce a clean, structured inventory report.
2. Build the Model Compatibility Database for **Milestone 2** (`src/linter/model-caps.json`).
