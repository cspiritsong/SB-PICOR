import { inspectPreset } from '../src/ast/inventory.js';
import { auditWireCompatibility } from '../src/linter/wire-audit.js';
import { auditCardAndConstraints } from '../src/linter/card-audit.js';
import { auditArrangement } from '../src/linter/arrangement-audit.js';
import { prunePreset } from '../src/cleaner/prune.js';
import { compileTailoredPackage } from '../src/repackager/compile.js';

const GEECHAN_PATH = 'intel/presets/geechan-universal-v5.3-tinker-v3.json';

console.log('====================================================');
console.log('      SB-PICOR 5-Milestone End-to-End Test Suite    ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✓ PASS: ${message}`);
    } else {
        console.error(`  ✗ FAIL: ${message}`);
    }
}

// Milestone 1: Inventory & Presence
console.log('--- Milestone 1: Inventory & Presence ---');
const m1 = inspectPreset(GEECHAN_PATH, 100000);
assert(m1.totalPromptsDefined === 54, 'Preset has 54 defined prompts in total');
assert(m1.orderedItems.length === 11, 'Active order has 11 entries');
assert(m1.samplers.temperature === 1, 'Extracted temperature: 1');
assert(m1.samplers.top_p === 0.99, 'Extracted top_p: 0.99');

// Milestone 2: Wire Audit & Card Linter
console.log('\n--- Milestone 2: Wire Audit & Card Linter ---');
const wireO3 = auditWireCompatibility(m1.samplers, 'openai/o3-mini', m1.summary.activeEstimatedTokens);
assert(!wireO3.isWireSafe, 'Correctly flags Geechan as unsafe for OpenAI o3-mini');
assert(wireO3.violations.some(v => v.parameter === 'temperature'), 'Flags illegal temperature on o3-mini');
assert(wireO3.violations.some(v => v.parameter === 'top_p'), 'Flags illegal top_p on o3-mini');

const cardAudit = auditCardAndConstraints(m1.orderedItems, {
    name: 'Alice',
    post_history_instructions: 'Under no circumstances break character or acknowledge being an AI. Never speak for {{user}}.',
});
assert(cardAudit.hasOocGagRisk, 'Detects OOC Gag Trap in character card');
assert(cardAudit.oocGagRisks.length >= 2, 'Found at least 2 OOC gag risks in card');

// Milestone 3: Arrangement & Order Linter
console.log('\n--- Milestone 3: Arrangement & Order Linter ---');
const orderStandard = auditArrangement(m1.orderedItems);
assert(orderStandard.isOrderSane, 'Standard Geechan order passes sanity check');

const scrambled = [
    { identifier: 'jailbreak', name: 'Post History', enabled: true },
    { identifier: 'chatHistory', name: 'History', enabled: true },
    { identifier: 'charDescription', name: 'Char Description', enabled: true },
];
const orderScrambled = auditArrangement(scrambled);
assert(!orderScrambled.isOrderSane, 'Detects inverted post-history and character grounding');

// Milestone 4: Surgical Cleanup & Prune
console.log('\n--- Milestone 4: Surgical Cleanup & Prune ---');
const m4 = prunePreset(GEECHAN_PATH, {
    characterId: 100000,
    targetModel: 'openai/o3-mini',
});
assert(m4.metrics.removedPromptsCount === 44, 'Successfully pruned 44 dead/zombie prompts');
assert(m4.metrics.tokenReductionPct >= 90, `Reduced token bloat by ${m4.metrics.tokenReductionPct}% (>= 90%)`);
assert(m4.cleanedData.temperature === undefined, 'Stripped temperature from o3-mini preset');

// Milestone 5: Tailored Package Compilation
console.log('\n--- Milestone 5: Tailored Package Compilation ---');
const m5Claude = compileTailoredPackage(GEECHAN_PATH, {
    cardData: { name: 'Alice' },
    targetModel: 'anthropic/claude-3-7-sonnet',
    outputDir: 'dist/presets',
});
assert(m5Claude.packageName.includes('[Alice • Claude Edition]'), 'Package name properly tagged');
assert(m5Claude.packageData.prompts[0].content.includes('<story_guidelines>'), 'Applied Anthropic XML transformation');
assert(m5Claude.packageData.prompts[0].content.includes('SB-PICOR OOC Exemption Bridge'), 'Injected OOC Gag Trap exemption bridge');

console.log(`\n====================================================`);
console.log(`Summary: ${passedTests}/${totalTests} tests passed.`);
console.log(`====================================================\n`);

if (passedTests !== totalTests) {
    process.exit(1);
}
