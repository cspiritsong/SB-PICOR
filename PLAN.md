# PLAN.md — SB-PICOR Execution Ledger

**Current Status:** Phase 1 — Project Initialization & Preset Intake  
**Active Lead:** Bobby/default  
**Workspace:** `/home/badi/projects/SB-PICOR`  

---

## 1. Milestone Roadmap

```text
[Phase 1: Intake & Recon] ──► Intake Geechan, Mother Midnight, Frankenstein; map schema
       │
[Phase 2: Static AST Linter] ──► Parse toggles, sampler compatibility, cache boundary breaks
       │
[Phase 3: Provider Compiler Rules] ──► Anthropic, OpenAI, Google, DeepSeek, Ollama targets
       │
[Phase 4: Optimization Agent Engine] ──► Deterministic JSON schema contract & conflict resolver
       │
[Phase 5: Extension UI & Repackager] ──► SillyBunny / SillyTavern plugin integration & export
```

---

## 2. Phase Breakdown

### Phase 1: Intake & Preset Schema Mapping (Current)
- [x] Establish project workspace contracts (`AGENTS.md`, `PROJECT.md`, `PLAN.md`, `README.md`).
- [x] Ingest Geechan Universal v5.3 (Meip's Tinker v3) into `intel/presets/`.
- [ ] Ingest reference presets: *Mother Midnight*, *Freaky Frankenstein*, *Pura Director*.
- [ ] Analyze preset JSON anatomy: top-level samplers, prompt arrays, order flags, injection points.

### Phase 2: Static AST Linter & Sampler Compatibility Matrix
- [ ] Build `src/ast/parser.js`: Extract active prompts, disabled toggles, and token weights.
- [ ] Build `src/linter/sampler-matrix.json`: Capability table mapping models (o3-mini, Claude, Gemini, DeepSeek, Ollama) to valid wire parameters.
- [ ] Build `src/linter/cache-analyzer.js`: Flag dynamic macro tokens (`{{time}}`, `{{random}}`) positioned in static system blocks.

### Phase 3: Provider Compiler Rulesets
- [ ] `src/targets/anthropic.js`: XML structure generator (`<guidelines>`, `<context>`), cache-breakpoint optimization, positive-constraint reframing.
- [ ] `src/targets/openai.js`: Markdown header structuring, developer-role formatting, automatic sampler stripping for o1/o3 models.
- [ ] `src/targets/google.js`: High-contrast system instruction consolidation, sampler normalization.
- [ ] `src/targets/deepseek.js`: Minimalist system prompt formatting, temperature/penalty safety ceilings.
- [ ] `src/targets/local.js`: Ollama `typical_p` stripping, mirostat adjustment.

### Phase 4: Deterministic Optimization Agent & Conflict Resolver
- [ ] Define JSON output schema for the optimization agent (`schema/optimization-plan.json`).
- [ ] Implement isolated diagnostic meta-prompt (immune to the OOC Gag Trap).
- [ ] Test conflict resolution on card vs. preset collisions (e.g. Victorian prose vs. modern street slang).

### Phase 5: Extension UI & Packaging
- [ ] SillyBunny / SillyTavern extension wrapper (`manifest.json`, `index.js`).
- [ ] UI modal: Inspect view (bloat breakdown), Optimization Plan review, and "Repackage for [Character • Model]" button.
- [ ] Non-destructive preset export and automatic activation in SillyBunny runtime.

---

## 3. Next Immediate Actions

1. Complete file setup (`README.md`, `.gitignore`, `discussions/` records).
2. Create case-insensitive symlinks (`agents.md`, `project.md`, `plan.md`, `readme.md`).
3. Update `/home/badi/projects/PROJECT_INDEX.md`.
4. Initialize local git repository in `SB-PICOR`.
5. Switch session into `SB-PICOR` via `desktop_project(action='create')`.
6. Inspect the ingested Geechan v5.3 preset schema with a Node analysis script.
