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

def call_deepseek(prompt):
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    payload = {
        'model': 'deepseek-flash',
        'messages': [
            {'role': 'system', 'content': 'You are DeepSeek Flash. Output clean, fully complete JavaScript ESM modules with zero truncation, following the Claude Opus 5 architecture plan.'},
            {'role': 'user', 'content': prompt}
        ],
        'max_tokens': 64000,
        'stream': True
    }
    
    print('Calling deepseek-flash via smolproxy-deepseek...')
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

prompt = """We are continuing the SB-PICOR Alpha 2 implementation.
`src/ast/source-indexer.js`, `src/mutate/tx.js`, and `templates/tpl-sb-picor-doctor.json` are already completed and verified.

Now implement the remaining Alpha 2 modules:
1. `src/agent/interceptor.js`:
   - State machine from Section 1.4 of Opus 5 plan.
   - `classifyOocIntent(query)`: heuristic scoring returning { isDiagnostic: boolean, score: number, reasons: string[] }.
   - `handleOocIntercept(message, context, host)`: handles user OOC queries, aborts character generation, and prepares diagnostic report.

2. `src/linter/card-audit.js`:
   - Upgraded to use `indexCardFields` from `../ast/source-indexer.js`.
   - Returns findings with exact `{ field, line, hash, text, fixToken, ruleLabel, snippet }`.
   - Mentions the OOC Gag Trap and negative constraint fatigue.

3. `src/targets/matrix.js`:
   - Consolidated compiler matrix exporting transformations for:
     - `anthropic`: XML structure (<guidelines>, <dialogue_rules>), positive reframing, OOC bridge.
     - `openai`: Markdown headings, developer-role, parameter stripping for o1/o3, max_completion_tokens.
     - `google`: Consolidated systemInstruction, non-standard sampler stripping.
     - `deepseek`: Minimalist system prompt for R1, penalty safety caps for V3.
     - `local`: Ollama/vLLM clean profile (stripping typical_p).

Format strictly as:
=== FILE: path/to/file ===
```javascript
code here
```
=== END FILE ===
"""

res = call_deepseek(prompt)
if res:
    with open('/home/badi/projects/SB-PICOR/deepseek-output-batch2.txt', 'w', encoding='utf-8') as f:
        f.write(res)
    print('Batch 2 raw output saved to deepseek-output-batch2.txt')
