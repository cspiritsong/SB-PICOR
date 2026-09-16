import os
import sys
import json
import time
import requests

api_key = ''
for line in open('/home/badi/.hermes/.env'):
    if line.startswith('HERMES_CUSTOM_SMOLPROXY_ANTHROPIC_API_KEY='):
        api_key = line.strip().split('=', 1)[1]
        break

if not api_key:
    print('ERROR: Missing HERMES_CUSTOM_SMOLPROXY_ANTHROPIC_API_KEY')
    sys.exit(1)

prompt = """You are Claude Opus 5, acting as the Principal Systems Architect for SillyBunny / SillyTavern and Hermes Agent.

# Background & Context
We are developing **SB-PICOR** (SillyBunny Preset Inspector, Cleaner, Optimizer, Repackager) in `/home/badi/projects/SB-PICOR`.
In Alpha 1 (v0.1.0-alpha.1), we built the core 5-milestone pipeline:
1. **Milestone 1 (Inventory):** AST parsing of preset JSON (`src/ast/inventory.js`), identifying active vs. 40+ zombie prompts, UI dividers, documentation blocks, and calculating token weights.
2. **Milestone 2 (Wire & Card Audit):** Catching hard HTTP 400 parameter crashers (`temperature`, `top_p`, penalties on OpenAI o1/o3; `typical_p` on modern Ollama; penalties on Grok) and detecting the "OOC Gag Trap" (`src/linter/wire-audit.js`, `src/linter/card-audit.js`).
3. **Milestone 3 (Arrangement):** Enforcing logical flow tiers and detecting dynamic cache-busting macros (`{{time}}`) in top static blocks (`src/linter/arrangement-audit.js`).
4. **Milestone 4 (Surgical Cleanup):** Non-destructively pruning dead prompts and illegal samplers, cutting preset bloat by 93% (`src/cleaner/prune.js`).
5. **Milestone 5 (Compilation):** Tailored preset compilation with Anthropic XML structure, OpenAI Markdown normalization, and the OOC exemption bridge (`src/repackager/compile.js`).
All 17/17 automated unit and integration tests pass. The extension is packaged as a standalone plugin (`manifest.json`, `index.js`, `style.css`).

# Target: Alpha 2 Architecture Specification
Badi's directive for Alpha 2:
Transform SB-PICOR into a true **In-Chat Doctor Agent** and an interactive, line-number precise debugger for SillyBunny.

We need your complete, deeply reasoned architectural plan covering four specific areas:

### 1. In-Chat Agent (ICA) Doctor Integration
- SillyBunny ships native In-Chat Agents (ICA) with companion support (`public/scripts/extensions/in-chat-agents/`).
- Companions can set `includeSystemPrompt: false` and `includePersona: false` to be 100% immune to the OOC Gag Trap.
- Specify the exact template JSON (`tpl-sb-picor-doctor.json`) and runtime hook.
- Specify how an automatic intercept works when a user types `[OOC: ...]` or `(OOC: ...)`: how the Doctor Agent catches the query, inspects the current chat stack, and replies with diagnostic clarity without breaking character continuity.

### 2. Line-Number Precision & Multi-Field Source Indexing
- Currently, our card audit scans basic strings.
- In SillyBunny, card instructions live across 7 distinct fields:
  1. `description`
  2. `personality`
  3. `scenario`
  4. `post_history_instructions` (the primary culprit)
  5. `system_prompt` (override)
  6. `mes_example`
  7. `creator_notes`
- Design an exact AST indexer (`src/ast/source-indexer.js`) that indexes every line with:
  `{ source: 'card'|'preset', field: string, line: number, text: string, tokenEstimate: number }`.
- Ensure it reports exact line numbers (1-indexed) so the user can locate the offending text in SillyBunny's UI.

### 3. Interactive State Mutation & Quick-Fix Actions
- In SillyBunny's browser runtime, when the user clicks an action in the Doctor's report, specify the exact JavaScript execution:
  - `muteCardLine(field, lineNumber)`: How to safely comment out or remove the line in `characters[characterId]` and invoke `saveCharacterDebounced()`.
  - `stripSampler(parameterName)`: How to remove the illegal parameter from active settings and invoke `saveSettingsDebounced()`.
  - `activateTailoredPreset(presetName)`: How to swap the chat's preset in SillyBunny without restarting.

### 4. Provider Grammar Matrix Expansion
- Concrete compiler transformation rules in `src/targets/`:
  - `anthropic.js`: Strict XML hierarchy (`<guidelines>`, `<dialogue_rules>`), prefix cache locking, positive constraint conversion.
  - `openai.js`: Markdown headings, developer role vs system role, stripping all samplers on o1/o3, mapping `max_completion_tokens`.
  - `google.js`: Unified systemInstruction consolidation, stripping non-standard samplers.
  - `deepseek.js`: Minimalist system prompt for R1 (official DeepSeek recommendation against jailbreaks), temperature/penalty ceilings for V3.
  - `local.js`: Ollama clean profile (dropping typical_p per #6044).

### 5. Implementation Roadmap for Coding Engine
- Break this down into concrete files, function signatures, data contracts, and test cases so our deep coder (DeepSeek Flash) can implement Alpha 2 cleanly and deterministically.

Deliver your architectural plan with full technical rigor.
"""

headers = {
    'x-api-key': api_key,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
}

payload = {
    'model': 'claude-opus-5',
    'messages': [
        {'role': 'user', 'content': prompt}
    ],
    'max_tokens': 16000,
    'stream': True,
    'thinking': {
        'type': 'adaptive'
    }
}

print('Sending Streaming Architecture Request to Claude Opus 5 (SmolProxy Anthropic)...')
t0 = time.time()
plan_path = '/home/badi/projects/SB-PICOR/.hermes/plans/sb-picor-alpha2-architecture.md'
os.makedirs(os.path.dirname(plan_path), exist_ok=True)

try:
    r = requests.post('https://smolproxy.org/anthropic/v1/messages', headers=headers, json=payload, stream=True, timeout=300)
    if r.status_code != 200:
        print(f'Error status {r.status_code}: {r.text[:300]}')
        sys.exit(1)

    collected_text = ''
    thinking_text = ''
    chunk_count = 0

    for line in r.iter_lines():
        if not line:
            continue
        line_str = line.decode('utf-8')
        if not line_str.startswith('data: '):
            continue
        data_str = line_str[6:].strip()
        if data_str == '[DONE]':
            break

        try:
            event = json.loads(data_str)
            event_type = event.get('type')
            if event_type == 'content_block_delta':
                delta = event.get('delta', {})
                d_type = delta.get('type')
                if d_type == 'text_delta':
                    text = delta.get('text', '')
                    collected_text += text
                    chunk_count += 1
                    if chunk_count % 50 == 0:
                        sys.stdout.write('.')
                        sys.stdout.flush()
                elif d_type == 'thinking_delta':
                    thinking_text += delta.get('thinking', '')
        except Exception:
            pass

    print(f'\nOpus 5 completed in {time.time()-t0:.1f}s!')
    print(f'Thinking tokens captured: ~{len(thinking_text)//4} tokens')
    print(f'Plan text captured: {len(collected_text)} chars (~{len(collected_text)//4} tokens)')

    with open(plan_path, 'w', encoding='utf-8') as f:
        f.write(collected_text)

    print(f'Architecture plan written to {plan_path}')

except Exception as e:
    print('Failed with exception:', e)
