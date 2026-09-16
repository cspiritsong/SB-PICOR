# PLAN.md — SB-PICOR Execution Ledger

**Current Status:** Core Engine (Milestones 1–5) Implemented & Verified (17/17 Tests Passing)  
**Active Lead:** Bobby/default  
**Workspace:** `/home/badi/projects/SB-PICOR`  

---

## 1. The 5-Milestone Roadmap

```text
[M1: Presence & Inventory]  ──► Inspect that preset & prompts exist; parse true structure (DONE)
       │
[M2: Wire & Anomaly Check]  ──► Catch illegal/unsupported model params & weird card instructions (DONE)
       │
[M3: Arrangement & Order]   ──► Validate sequence (system vs card vs post-history vs cache prefix) (DONE)
       │
[M4: Surgical Cleanup]      ──► Prune dead revisions, dividers, READMEs, duplicate constraints (DONE)
       │
[M5: Package Optimization]  ──► Compile lean, tailored, card+model-locked runtime preset (DONE)
```

---

## 2. Milestone Verification Ledger

### Milestone 1: Inspect that Preset / Prompts Exist (Presence & Inventory)
- [x] Ingest benchmark artifact: Geechan Universal v5.3 (Meip's Tinker v3).
- [x] Implemented `src/ast/inventory.js`: Resolves active `prompt_order`, tags UI dividers and doc blocks, measures true token weights.
- [x] **Verified:** Parses Geechan's 54 prompt blocks, separates active order (11 entries) from 43 zombie prompts.

### Milestone 2: Inspect that Nothing Weird is Going On (Anomalies & Incompatibilities)
- [x] Implemented `src/linter/model-caps.json`: Capability matrix for OpenAI o1/o3, Claude 3.7, Gemini 2.5, DeepSeek R1/V3, Ollama, Grok.
- [x] Implemented `src/linter/wire-audit.js`: Catches hard HTTP 400 crashers (`temperature`, `top_p`, `penalties` on o3-mini; `typical_p` on Ollama).
- [x] Implemented `src/linter/card-audit.js`: Catches the "OOC Gag Trap" and negative constraint fatigue.
- [x] **Verified:** Correctly caught 8 illegal samplers for o3-mini and 2 OOC gag traps in test card.

### Milestone 3: Inspect that the Arrangement is Correct (Sequence & Cache Alignment)
- [x] Implemented `src/linter/arrangement-audit.js`: Validates logical flow tiers (System $\to$ Character $\to$ Context $\to$ History $\to$ Post-History) and flags dynamic cache-busting macros (`{{time}}`) in top prefixes.
- [x] **Verified:** Passed standard Geechan order, flagged inverted post-history and character grounding in scrambled orders.

### Milestone 4: Can a Cleanup Occur? (Surgical Pruning)
- [x] Implemented `src/cleaner/prune.js`: Non-destructively purges dead revisions, comment dividers, and unsupported wire samplers.
- [x] **Verified:** Reduced Geechan v5.3 file bloat by **93%** (from 223,020 chars down to 16,689 chars), stripping 44 dead prompts and 8 illegal o3-mini samplers.

### Milestone 5: Can Optimizing Occur as a Package? (Tailored Compilation)
- [x] Implemented `src/repackager/compile.js`: Compiles tailored runtime preset packages (`Geechan v5.3 [Alice • Claude Edition]`).
- [x] Provider grammar transforms: Anthropic XML structure (`<story_guidelines>`) and OpenAI Markdown normalization.
- [x] OOC Gag Trap resolution: Injects explicit diegetic OOC exemption bridge into compiled system prompts.
- [x] **Verified:** Successfully compiled and exported tailored packages to `dist/presets/`.

---

## 3. Test Suite Status

- **Automated Harness:** `tests/sb-picor.test.js`
- **Result:** **17/17 tests passing (100%)**.

---

## 4. Next Phase: SillyBunny Extension UI

- Build `src/extension/`:
  - SillyBunny / SillyTavern plugin manifest (`manifest.json`).
  - Top bar / Preset drawer "🩺 SB-PICOR Doctor" button.
  - Interactive UI modal allowing users to click "Inspect", see the 5-milestone diagnostics, click "Clean & Optimize", and one-tap "Repackage for Active Card".
