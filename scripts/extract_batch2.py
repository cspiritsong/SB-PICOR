import os
import re

text = open('/home/badi/projects/SB-PICOR/deepseek-output-batch2.txt', encoding='utf-8').read()

pattern = re.compile(r'=== FILE:\s*([^\s=]+)\s*===\s*```(?:javascript|json)?\s*([\s\S]*?)\s*```\s*=== END FILE ===', re.MULTILINE)

matches = pattern.findall(text)
print(f'Matched {len(matches)} files.')

for file_path, content in matches:
    full_path = os.path.join('/home/badi/projects/SB-PICOR', file_path.strip())
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, 'w', encoding='utf-8') as f:
        f.write(content.strip() + '\n')
    print(f'Wrote: {full_path} ({len(content)} chars)')
