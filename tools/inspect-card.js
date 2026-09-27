import fs from 'fs';
import { indexCard } from '../src/ast/source-indexer.js';
import { auditCardAndConstraints } from '../src/linter/card-audit.js';

const targetPath = process.argv[2] || 'intel/test-card.json';
const raw = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
const card = raw.data || raw;

console.log(`=== Inspecting Card: ${card.name || 'Unnamed'} ===`);
const indexed = indexCard(card);
console.log(`Total Indexed Lines across Card Fields: ${indexed.length}`);

const fieldCounts = {};
for (const line of indexed) {
    fieldCounts[line.field] = (fieldCounts[line.field] || 0) + 1;
}
for (const [field, count] of Object.entries(fieldCounts)) {
    console.log(`  - Field '${field}': ${count} lines`);
}

const audit = auditCardAndConstraints([], card);
console.log(`\nOOC Gag Trap Detected: ${audit.hasOocGagRisk}`);
if (audit.hasOocGagRisk) {
    console.log(`OOC Gag Risks Found: ${audit.oocGagRisks.length}`);
    for (const risk of audit.oocGagRisks) {
        console.log(`  [Line ${risk.line} in ${risk.field}] "${risk.snippet}" -> ${risk.reason}`);
    }
}

