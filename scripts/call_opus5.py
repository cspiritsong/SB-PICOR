import os
import sys
import json
import time
import requests

# Load keys
xkiro_key = ''
for line in open('/home/badi/.hermes/.env'):
    if line.startswith('HERMES_CUSTOM_XKIRO_API_KEY='):
        xkiro_key = line.strip().split('=', 1)[1]
        break

if not xkiro_key:
    print('ERROR: Missing HERMES_CUSTOM_XKIRO_API_KEY')
    sys.exit(1)

prompt = """You are Claude Opus 5, acting as the Principal Systems Architect for the SillyBunny / SillyTavern ecosystem.

# Background & Problem Statement
Users in the SillyBunny roleplay community face three compounding failures:
1. **The "Monolithic Preset" Problem:** Community presets (Geechan Universal v5.3, Mother Midnight, Freaky Frankenstein) bundle 50+ prompt blocks, dead revision histories, and rigid samplers into 4,000+ token JSONs.
2. **The "OOC Gag Trap":** Cardmakers and presets put rules like "Under no circumstances break character or acknowledge being an AI" into character cards or post-history prompts. When a user asks an Out-Of-Character troubleshooting question like `[OOC: Why are you looping?]`, the model receives those instructions *before* the OOC question, gagging it and causing cryptic loops, refusal, or broken roleplay.
3. **Model Wire Crashes (HTTP 400):** Presets forward legacy parameters that target models reject (e.g. OpenAI o1/o3 reject temperature/top_p/penalties; modern Ollama rejects typical_p following upstream llama.cpp removal; Grok rejects penalties).

# What We Built in Alpha 1 (v0.1.0-alpha.1)
We built and published SB-PICOR (SillyBunny Preset Inspector, Cleaner, Optimizer, Repackager) as a standalone extension (cspiritsong/SB-PICOR):
- `src/ast/inventory.js`: Parses preset JSON, resolves prompt_order (100000 default vs custom), isolates active prompts from dead revisions and dividers.
- `src/linter/wire-audit.js`: Detects hard HTTP 400 crashers against a model capability matrix.
- `src/linter/card-audit.js`: Detects the OOC Gag Trap and negative constraint fatigue.
- `src/linter/arrangement-audit.js`: Validates prompt flow tiers and checks for dynamic macros ({{time}}) breaking prompt cache prefixes.
- `src/cleaner/prune.js`: Non-destructively prunes dead revisions and dividers, cutting preset bloat by 93%.
- `src/repackager/compile.js`: Compiles tailored presets for specific characters and models, and injects an OOC exemption bridge into system prompts.
- Test suite: 17/17 automated tests passing.
- Extension wrapper: `index.js`, `manifest.json`, `style.css`.

# Goal for Alpha 2 (v0.2.0-alpha.2)
Badi directed us to evolve SB-PICOR into a true **In-Chat Doctor Agent** and an interactive, line-number precise debugger for SillyBunny.
We need your deep architectural plan for:
1. **In-Chat Agent (ICA) Doctor Mode:**
   - SillyBunny has a native In-Chat Agents (ICA) system (`public/scripts/extensions/in-chat-agents/`) supporting Companion Agents with `includeSystemPrompt: false` and `includePersona: false`.
   - Design how SB-PICOR hooks into ICA (as an official template `tpl-sb-picor-doctor.json` or companion hook).
   - Design the automatic intercept for `[OOC: ...]` messages so the Doctor Agent runs in a clean context and diagnoses the user's issue without persona interference.
2. **Line-Number Precision & Source Indexing:**
   - Upgrade the card and preset linters to index text lines across all 7 card fields (description, personality, scenario, post_history_instructions, system_prompt, mes_example, creator_notes) and preset blocks, returning exact 1-indexed line numbers and verbatim snippets.
3. **Interactive UI State Mutation:**
   - In SillyBunny, how does the Doctor's action buttons actually mutate state safely in the browser?
     - Muting/editing a line in `characters[characterId]` and calling `saveCharacterDebounced()`.
     - Stripping a sampler from `preset` and calling `saveSettingsDebounced()`.
     - Activating a newly compiled preset for the active chat.
4. **Target Model Compiler Grammars:**
   - Solidify compiler transformations for:
     - Anthropic Claude 3.5/3.7 (XML tagging, cache-boundary locking, positive reframing).
     - OpenAI o1/o3-mini (Markdown headers, developer-role, parameter stripping, max_completion_tokens).
     - Google Gemini 2.5/3.0 (SystemInstruction consolidation, sampler normalization).
     - DeepSeek R1/V3 (Minimalist system prompt, penalty ceilings).
     - Local Ollama (typical_p stripping, context ceiling guards).

Provide a comprehensive, highly concrete, file-by-file architectural implementation plan for Alpha 2. Specify exact function signatures, data contracts, state mutations, and test cases so our deep-cooking coding engine (DeepSeek Flash) can implement it with zero ambiguity.
"""

headers = {
    'Authorization': f'Bearer {xkiro_key}',
    'Content-Type': 'application/json'
}

payload = {
    'model': 'anthropic/claude-opus-5',
    'messages': [
        {'role': 'system', 'content': 'You are Claude Opus 5, Principal Systems Architect for SillyBunny and Hermes Agent.'},
        {'role': 'user', 'content': prompt}
    ],
    'max_tokens': 8192
}

print('Dispatching Architecture Request to Claude Opus 5 via xkiro...')
t0 = time.time()
try:
    r = requests.post('https://api.xkiro.com/v1/chat/completions', headers=headers, json=payload, timeout=180)
    print(f'Opus 5 responded in {time.time()-t0:.1f}s | Status: {r.status_code}')
    if r.status_code == 200:
        data = r.json()
        print('JSON keys:', list(data.keys()))
        if 'choices' in data and len(data['choices']) > 0:
            content = data['choices'][0]['message']['content']
            plan_path = '/home/badi/projects/SB-PICOR/.hermes/plans/sb-picor-alpha2-architecture.md'
            os.makedirs(os.path.dirname(plan_path), exist_ok=True)
            with open(plan_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f'Plan saved to {plan_path} ({len(content)} chars)')
        else:
            print('Unexpected response shape:', json.dumps(data)[:500])
    else:
        print('Error:', r.text)
except Exception as e:
    print('Failed:', e)
