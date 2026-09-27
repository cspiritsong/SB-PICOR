import fs from 'fs';
import { auditCard } from '../src/linter/card-audit.js';

const targetPath = process.argv[2] || 'intel/test-card.json';
const card = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

console.log(`=== Full Forensic Audit: ${card.name || card.data?.name || 'Unnamed'} ===`);
const audit = auditCard(card);

console.log(`Total Findings: ${audit.findings.length}`);
console.log(`Findings by Rule:`);
for (const [rule, count] of Object.entries(audit.stats.byRule || {})) {
    console.log(`  - ${rule}: ${count}`);
}

console.log(`\nDetailed Top Findings:`);
for (const f of audit.findings.slice(0, 15)) {
    console.log(`  • [${f.ruleLabel}] ${f.field} (line ${f.line}):`);
    console.log(`    "${f.snippet}"`);
}
