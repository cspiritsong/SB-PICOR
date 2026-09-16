# PLAN.md — SB-PICOR Execution Ledger

**Current Status:** v0.1.0-alpha.1 Released on GitHub (`cspiritsong/SB-PICOR`)  
**Active Lead:** Bobby/default  
**Workspace:** `/home/badi/projects/SB-PICOR`  
**GitHub URL:** `https://github.com/cspiritsong/SB-PICOR`  

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
       │
[Delivery: Standalone Ext]  ──► Package as SillyBunny extension, publish v0.1.0-alpha.1 (DONE)
```

---

## 2. Release & Verification Ledger

- [x] Ingest benchmark artifact: Geechan Universal v5.3 (Meip's Tinker v3).
- [x] Built core modules in `src/` (AST inventory, wire audit, card audit, arrangement audit, cleaner, repackager).
- [x] Test suite: 17/17 tests passing (`tests/sb-picor.test.js`).
- [x] Standalone extension wrapper: `manifest.json`, `index.js`, `style.css`.
- [x] Local integration verified in SillyBunny third-party extensions.
- [x] Remote GitHub repository created: `https://github.com/cspiritsong/SB-PICOR`.
- [x] Released **v0.1.0-alpha.1**: `https://github.com/cspiritsong/SB-PICOR/releases/tag/v0.1.0-alpha.1`.
- [x] Identity sanitation: default CLI account returned to `badiyee85`, git remote clean of tokens.

---

## 3. Community Feedback & Iteration (Next Actions)

1. Test installation on canary testbeds (`bobby-laptop`, port 4445).
2. Gather feedback from community testers on complex presets (Mother Midnight, Freaky Frankenstein).
3. Prepare upstream vendor proposal for SillyBunny maintainers once battle-tested.
