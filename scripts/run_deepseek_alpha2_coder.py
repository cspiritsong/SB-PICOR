import os
import sys
import json
import time
import requests

api_key = ''
for line in open('/home/badi/.hermes/.env'):
    if line.startswith('HERMES_CUSTOM_SMOLPROXY_DEEPSEEK_API_KEY='):
        api_key = line.strip().split('=', 1)[1]
        break

if not api_key:
    print('ERROR: Missing HERMES_CUSTOM_SMOLPROXY_DEEPSEEK_API_KEY')
    sys.exit(1)

plan_text = open('/home/badi/projects/SB-PICOR/.hermes/plans/sb-picor-alpha2-architecture.md', encoding='utf-8').read()

def call_deepseek(prompt):
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    payload = {
        'model': 'deepseek-flash',
        'messages': [
            {'role': 'system', 'content': 'You are DeepSeek Flash, the premier deep-cooking engineering model for SillyBunny. You follow Claude Opus 5 architecture blueprints with zero improvisation, strict ESM, pure functions where specified, and bulletproof error handling.'},
            {'role': 'user', 'content': prompt}
        ],
        'max_tokens': 64000,
        'stream': True
    }
    
    print('Calling deepseek-flash via smolproxy-deepseek (streaming, 64k cap)...')
    t0 = time.time()
    r = requests.post('https://smolproxy.org/deepseek/v1/chat/completions', headers=headers, json=payload, stream=True, timeout=300)
    if r.status_code != 200:
        print(f'Error: {r.status_code} {r.text[:300]}')
        return None
        
    collected = ''
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
            chunk = json.loads(data_str)
            delta = chunk['choices'][0]['delta']
            if 'content' in delta and delta['content']:
                collected += delta['content']
                chunk_count += 1
                if chunk_count % 100 == 0:
                    sys.stdout.write('.')
                    sys.stdout.flush()
        except Exception:
            pass
            
    print(f'\nCompleted in {time.time()-t0:.1f}s! ({len(collected)} chars)')
    return collected

prompt_batch1 = f"""Here is the Claude Opus 5 Architecture Blueprint for SB-PICOR Alpha 2:
{plan_text}

Your task: Implement the first batch of Alpha 2 files in pure Node.js ESM:
1. `src/ast/source-indexer.js`:
   - Scans text across all 7 card fields (description, personality, scenario, post_history_instructions, system_prompt, mes_example, creator_notes) and preset prompt blocks.
   - Splits lines losslessly (handling \\r\\n, \\n, trailing newlines).
   - Generates 1-indexed line objects:
     `{{ source: 'card'|'preset', field: string, line: number, text: string, hash: string, tokenEstimate: number }}`
   - Provides `resolveAnchor(lines, anchor)` with exact match, relocated search (±5 lines), and drift detection per Invariant I2.

2. `src/mutate/tx.js`:
   - Invariant I3: Transaction journaling with pre-image snapshots and rollback.
   - Invariant I4: FixToken generation and verification.
   - Implements `muteCardLine(card, field, lineNumber, expectedHash)`: comments out the offending line (`// [Muted by SB-PICOR]: ...`).
   - Implements `stripSampler(preset, parameterName)`.
   - Implements `undoLast(txJournal)`.

3. `templates/tpl-sb-picor-doctor.json`:
   - Complete In-Chat Agent template matching Section 1.2 with structural immunity (`includeSystemPrompt: false`, `includePersona: false`, `includeCharacterCard: false`), triggers for `[OOC: ...]` and `/doctor`.

4. `src/agent/interceptor.js`:
   - Implements OOC intercept state machine matching Section 1.4.
   - Exports `classifyOocIntent(query)` (heuristic score 0.0 to 1.0 detecting debug/technical intent vs in-character OOC).
   - Exports `handleOocIntercept(message, context)`.

Output your code strictly in this format so it can be extracted cleanly:
=== FILE: path/to/file ===
```javascript (or json)
code here
```
=== END FILE ===
"""

res = call_deepseek(prompt_batch1)
if res:
    with open('/home/badi/projects/SB-PICOR/deepseek-output-batch1.txt', 'w', encoding='utf-8') as f:
        f.write(res)
    print('Batch 1 raw output saved to deepseek-output-batch1.txt')
