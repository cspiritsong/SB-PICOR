# PLAN.md — SB-PICOR Execution Ledger

**Current Status:** v0.2.0-alpha.2 Released on GitHub (`cspiritsong/SB-PICOR`)  
**Active Lead:** Bobby/default  
**Workspace:** `/home/badi/projects/SB-PICOR`  
**GitHub URL:** `https://github.com/cspiritsong/SB-PICOR`  

---

## 1. Dual-Model Architecture Execution

In accordance with Badi's Universal Model Routing:
1. **Architectural Blueprint:** Claude Opus 5 (`claude-opus-5` via SmolProxy Anthropic with adaptive thinking) designed the Alpha 2 specification (`.hermes/plans/sb-picor-alpha2-architecture.md`, 14,662 chars). Defined non-negotiable invariants (I1–I8), two-phase transactions, fix tokens, and OOC intercept state machine.
2. **Deep-Cooking Implementation:** DeepSeek Flash (`deepseek-flash` via `smolproxy-deepseek` @ max with streaming, 64k cap) wrote the full implementation across 180k+ characters of pure ESM code.
3. **Verification:** 46/46 automated assertions passing (17 legacy + 29 Alpha 2 invariant tests).

---

## 2. Invariants Sealed in Alpha 2

| Invariant | Meaning | Enforcement |
| :--- | :--- | :--- |
| **I1** | **Pure core, impure edge:** `src/ast/`, `src/linter/`, `src/mutate/`, `src/targets/` hold zero clocks, zero DOM, zero random state. | Enforced by pure function signatures; tested in `tests/alpha2.test.js`. |
| **I2** | **Anchor resolution:** No mutation without an anchor (field + line + content hash). Prevents editing shifted/drifted text. | `resolveAnchor()` returns `exact`, `relocated`, or `drift`. |
| **I3** | **Transaction journaling:** Every write creates a pre-image snapshot and is completely reversible. | `createTxEngine()`, `createJournal()`, `undoLast()`. |
| **I4** | **FixToken security:** LLMs may name a fix, but only the analyzer can mint one. | `mintFixToken()`, `verifyFixToken()`. |
| **I5** | **Agent structural immunity:** In-Chat Agent Doctor never includes character persona or system prompt. Immune to the OOC Gag Trap. | `tpl-sb-picor-doctor.json`: `includeSystemPrompt: false`, `includePersona: false`. |
| **I8** | **Round-trip losslessness:** `join(split(text)) === text` for all unicode, CRLF, and trailing newlines. | `assertRoundTrip()` tested on edge-case strings. |

---

## 3. Releases

- **v0.1.0-alpha.1:** Initial 5-milestone batch analyzer and standalone extension.
- **v0.2.0-alpha.2:** Full In-Chat Doctor Agent, two-phase mutation journal, multi-field 1-indexed line indexer, OOC interceptor, and provider compiler matrix (Anthropic, OpenAI, Google, DeepSeek, Local).
