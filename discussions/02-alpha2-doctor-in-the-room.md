# Discussion 02: SB-PICOR Alpha 2 — Doctor In The Room

**Date:** 2026-09-16  
**Session ID:** `@session:default/20260916_132812_e5d7ea`  
**Participants:** Badi, Bobby (Gemini 3.8 Flash via SmolProxy)  
**Architect:** Claude Opus 5 (via SmolProxy Anthropic with adaptive thinking)  
**Implementer:** DeepSeek Flash (via SmolProxy DeepSeek @ max with streaming)  
**Topic:** In-Chat Doctor Agent, Invariants I1–I8, Two-Phase Transaction Journaling, Multi-Field Indexing, and Release v0.2.0-alpha.2  

---

## 1. Context & Evolution from Alpha 1

Following the initial Alpha 1 batch analyzer release, Badi provided two crucial course corrections:
1. **Focus on General Troubleshooting, Not Specific Presets:** Geechan v5.3 was an intake example of bloat, not the target itself. The real target is empowering the everyday user who pairs an arbitrary model, community preset, and character card.
2. **Line-Number Precision & Diagnostic Specificity:** Instead of generic summaries, the tool must tell the user the exact component, field, line number, and verbatim snippet causing breakdowns.
3. **In-Chat Doctor Agent Architecture:** SillyBunny natively promotes In-Chat Agents (ICA). Packaging the Doctor as an ICA Companion Agent grants structural immunity to the OOC Gag Trap by setting `includeSystemPrompt: false` and `includePersona: false`.

---

## 2. Dual-Model Execution Ledger

### Architectural Plan by Claude Opus 5
- **Artifact:** `.hermes/plans/sb-picor-alpha2-architecture.md` (14,662 characters).
- **Invariants Established:**
  - **I1 (Pure core, impure edge):** Core modules hold zero clocks, DOM, or random state.
  - **I2 (Anchor resolution):** No mutation without verifying field, line, and content hash; drift detection prevents corrupting edited lines.
  - **I3 (Transaction journaling):** Pre-image snapshots before every mutation; full reversibility via `undoLast()`.
  - **I4 (FixToken security):** LLMs may name a fix, but only the analyzer can mint an authorized token to execute it.
  - **I5 (Structural immunity):** In-Chat Agent Doctor template excludes system prompt and persona.
  - **I8 (Round-trip losslessness):** `join(split(text)) === text` for all unicode, CRLF, and trailing newlines.

### Deep-Cooking Implementation by DeepSeek Flash
- **Output:** Over 180,000 characters of strict ESM JavaScript across two streaming sessions with 64k caps.
- **Modules Produced:**
  1. `src/ast/source-indexer.js`: Multi-field indexer across all 7 card fields with 1-indexed lines and content hash anchors.
  2. `src/mutate/tx.js`: Two-phase transaction engine (`createTxEngine()`), FixToken registry, staging/commit lifecycle, and rollback.
  3. `src/agent/interceptor.js`: State machine intercepting technical `[OOC: ...]` queries before roleplay generation builds.
  4. `src/linter/card-audit.js`: Line-numbered card linter reporting exact breadcrumbs.
  5. `src/targets/matrix.js`: Full compiler matrix for Anthropic XML, OpenAI Markdown/o-series, Google Gemini, DeepSeek R1/V3, and Local Ollama.
  6. `templates/tpl-sb-picor-doctor.json`: Official In-Chat Agent template.

---

## 3. Verification & Release

- **Automated Test Suite:** `tests/sb-picor.test.js` (17/17) + `tests/alpha2.test.js` (29/29) = **46/46 assertions passing**.
- **GitHub Release:** Tagged and released as **`v0.2.0-alpha.2`** at `https://github.com/cspiritsong/SB-PICOR/releases/tag/v0.2.0-alpha.2`.
- **Kanban Task:** `t_556d22da` completed and verified.
- **Identity & Remotes:** Cleanly pushed via `cspiritsong`; default CLI account remains `badiyee85`.
