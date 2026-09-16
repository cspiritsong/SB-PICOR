# PROJECT.md — SB-PICOR (SillyBunny Preset Inspector, Cleaner, Optimizer, Repackager)

**Workspace Location:** `/home/badi/projects/SB-PICOR`  
**Aliases:** `~/projects/SB-PICOR`, `~/SB-PICOR`, `~/projects/sb-picor`  
**Coordinator & Executor:** Bobby/default  
**Principal:** Badi  

---

## 1. Executive Summary

**SB-PICOR** is an autonomous **Preset & Character Card Doctor Agent** packaged as a standalone extension for the SillyBunny and SillyTavern ecosystem.

Instead of vague summaries or black-box failures, SB-PICOR acts like an intelligent code debugger with **line-number precision**. It inspects the interaction between the user's **Active Model**, **Loaded Preset**, and **Character Card**, pinpointing the exact field, line number, and rule causing chat breakdowns.

### The Delivery Strategy
Per Badi's directive (2026-09-16):
- **Ecosystem-First Extension:** Developed, tested, and published as a standalone community extension under `cspiritsong/SB-PICOR`.
- **Installable via Extension Manager:** One-click install via Git URL (`https://github.com/cspiritsong/SB-PICOR`) directly into `public/scripts/extensions/third-party/SB-PICOR`.
- **Zero Core Burden:** Does not require emergency upstream PRs. Once proven, battle-tested, and loved by the community, SillyBunny maintainers can choose to vendor or adopt it into core.

---

## 2. Repositories and GitHub Identity Lanes

| Role | Repository / Remote | GitHub Account | Credential / Protocol |
| :--- | :--- | :--- | :--- |
| **Extension Repo** | `cspiritsong/SB-PICOR` | `cspiritsong` | `GITHUB_CSPIRITSONG_TOKEN` |
| **Upstream Target** | `SillyBunnyTeam/SillyBunny` (Extensions) | N/A (read-only) | Read-only |
| **Daily Operations** | N/A | `badiyee85` | Default `gh` account |

*All public git remotes, tags, and releases belong strictly to the `cspiritsong` identity lane.*

---

## 3. What the Doctor Agent Delivers

When summoned via the **`🩺` Doctor Icon**, slash command (`/doctor` or `/picor`), or when intercepting an `[OOC: ...]` query:

1. **Exact Forensic Breadcrumbs:**
   - **Component:** (e.g. *Character Card "Alice"*, *Preset "Mother Midnight"*, *Samplers*)
   - **Box/Field:** (e.g. *Post-History Instructions*, *Prompt #4 (jailbreak)*, *Description*)
   - **Line Number:** Exact 1-indexed line number in that field.
   - **Exact Text:** Verbatim snippet causing the conflict.
2. **The "OOC Gag Trap" Detection:**
   - Identifies rules like `"Under no circumstances break character"` that gag the AI when users try to troubleshoot in chat.
3. **Model Wire Compatibility:**
   - Detects unsupported samplers (`temperature` on o3-mini, `typical_p` on modern Ollama) before generation crashes with HTTP 400.
4. **Actionable Remediation:**
   - `[✂️ Mute Line]`: Disables or removes the offending line from the card/preset.
   - `[⚡ Strip Sampler]`: Strips illegal wire parameters for the active model.
   - `[📦 Repackage Lean Preset]`: Compiles a tailored, conflict-free preset for that specific character and model.

---

## 4. Extension File Layout

```text
~/projects/SB-PICOR/
├── manifest.json             # SillyTavern / SillyBunny extension manifest
├── index.js                  # Extension entrypoint, UI injection, slash commands
├── style.css                 # Clean diagnostic cards and inspector modal styling
├── AGENTS.md                 # Agent operating contract, rules, and provider invariants
├── PROJECT.md                # Project mission, architecture, and repo map
├── PLAN.md                   # Live execution ledger & milestone tracking
├── README.md                 # Public documentation and installation guide
├── src/                      # Core engine
│   ├── ast/                  # Preset parser and token weight calculator
│   ├── linter/               # Wire audit, card linter, and arrangement checker
│   ├── cleaner/              # Dead-prompt and divider pruner
│   └── repackager/           # Tailored preset compiler
├── tests/                    # Automated regression test suite (17/17 passing)
└── discussions/              # Historical transcripts and architectural decisions
```
