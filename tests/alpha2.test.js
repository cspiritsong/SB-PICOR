import fs from 'fs';
import path from 'path';

import {
    splitLines,
    joinParts,
    hashText,
    indexCard,
    resolveAnchor,
    assertRoundTrip,
} from '../src/ast/source-indexer.js';

import {
    createTxEngine,
} from '../src/mutate/tx.js';

import { auditCard } from '../src/linter/card-audit.js';
import { classifyOocIntent } from '../src/agent/interceptor.js';
import { compileForModel, detectTarget } from '../src/targets/matrix.js';

console.log('====================================================');
console.log('       SB-PICOR Alpha 2 Comprehensive Test Suite    ');
console.log('====================================================\n');

let passed = 0;
let total = 0;

function assert(condition, message) {
    total++;
    if (condition) {
        passed++;
        console.log(`  ✓ PASS: ${message}`);
    } else {
        console.error(`  ✗ FAIL: ${message}`);
    }
}

// 1. Invariant I8: Round-Trip Losslessness
console.log('--- Test 1: Invariant I8 (Lossless Line Splitting) ---');
const sampleText = 'Line 1\r\nLine 2 with spaces   \nLine 3 with unicode: 🌸\n\nTrailing line\n';
const parts = splitLines(sampleText);
const reconstructed = joinParts(parts);
assert(reconstructed === sampleText, 'joinParts(splitLines(text)) exactly equals original text');
assert(parts.length === 6, 'Correctly identified 6 line parts including trailing newline');
assert(assertRoundTrip(sampleText), 'assertRoundTrip passes for complex text');

// 2. Invariant I2: Anchor Resolution & Drift Prevention
console.log('\n--- Test 2: Invariant I2 (Anchor Resolution & Drift) ---');
const cardData = {
    name: 'Alice',
    description: 'Street rogue.\nAlways alert.\nNever speaks first.',
    post_history_instructions: 'Rule 1: Be descriptive.\nRule 2: Under no circumstances break character or acknowledge being an AI.\nRule 3: Have fun.',
};
const cardLines = indexCard(cardData);
const targetLine = cardLines.find(l => l.field === 'post_history_instructions' && l.line === 2);
assert(targetLine !== undefined, 'Indexed target line 2 in post_history_instructions');

const anchor = {
    field: 'post_history_instructions',
    line: 2,
    hash: targetLine.hash,
    snippet: targetLine.text,
};
const exactRes = resolveAnchor(cardLines, anchor);
assert(exactRes.status === 'exact', 'Anchor resolves to status: exact');

// Drift test
const driftedAnchor = { ...anchor, hash: 'bad_hash_123' };
const driftRes = resolveAnchor(cardLines, driftedAnchor);
assert(driftRes.status === 'drift', 'Anchor correctly flags status: drift when content hash mismatches');

// 3. Invariant I3 & I4: Two-Phase Commit Transaction Engine & Reversibility
console.log('\n--- Test 3: Invariant I3 & I4 (Two-Phase Transactions & FixTokens) ---');
const engine = createTxEngine({ now: () => 1700000000000, entropy: () => 'seed12345678' });
let mutableCard = JSON.parse(JSON.stringify(cardData));

// Mint fix token for target
const mintRes = engine.mint({
    op: 'muteCardLine',
    fixId: 'fix_ooc_gag_2',
    target: { kind: 'card', id: 'Alice', field: 'post_history_instructions', line: 2 },
});
assert(mintRes.ok === true, 'Minted FixToken successfully');

// Execute mute operator (stages transaction)
const muteRes = engine.muteCardLine(mutableCard, 'post_history_instructions', 2, targetLine.hash, {
    fixToken: mintRes.token,
    confirmed: true,
});
assert(muteRes.ok === true, 'muteCardLine staged successfully');
mutableCard = muteRes.card;
assert(mutableCard.post_history_instructions.includes('// [Muted by SB-PICOR]: Rule 2:'), 'Card line is commented out with Mute banner');

// Commit transaction
const commitRes = engine.commit(muteRes.entry.id);
assert(commitRes.ok === true, 'Transaction committed to journal');
assert(engine.getJournal().entries.length === 1, 'Journal records 1 active transaction');

// Test Undo / Rollback
const undoRes = engine.undoLast();
assert(undoRes.ok === true, 'undoLast rolled back transaction');
assert(undoRes.patch.value === cardData.post_history_instructions, 'Pre-image snapshot restored original field text exactly');

// 4. Line-Numbered Card Linter
console.log('\n--- Test 4: Line-Numbered Card Linter ---');
const auditResult = auditCard(cardData);
assert(auditResult.findings.length > 0, 'Card audit produced findings');
const gagFinding = auditResult.findings.find(f => f.ruleLabel === 'OOC Gag Trap' || f.fixToken === 'DISSOLVE-GAG-TRAP');
assert(gagFinding !== undefined, 'Found OOC Gag finding with exact line number');
assert(gagFinding.field === 'post_history_instructions', 'Pinpoints field: post_history_instructions');
assert(gagFinding.line === 2, 'Pinpoints exact line: 2');

// 5. In-Chat Interceptor Intent Classifier
console.log('\n--- Test 5: OOC Intent Classifier ---');
const diagnosticQuery = '[OOC: Why are you looping on this response?]';
const normalChat = 'Hey, let us head to the tavern next';
const diagScore = classifyOocIntent(diagnosticQuery);
const normalScore = classifyOocIntent(normalChat);
assert(diagScore.isDiagnostic === true, 'Correctly flags technical/diagnostic OOC query');
assert(normalScore.isDiagnostic === false, 'Correctly passes in-character chat message');

// 6. Provider Compiler Matrix
console.log('\n--- Test 6: Provider Compiler Matrix ---');
const ir = {
    systemRules: 'Do not speak for user. Never break character. Always write prose.',
    characterPersona: 'Alice the rogue.',
    samplers: { temperature: 1.0, top_p: 0.95, typical_p: 1.0, presence_penalty: 0.2 },
};

const claudeCompiled = compileForModel('claude-3-7-sonnet', ir);
assert(claudeCompiled.target === 'anthropic', 'Detected Anthropic target for Claude');
assert(claudeCompiled.system.includes('<ooc_bridge>'), 'Rendered Anthropic XML structure with OOC bridge');

const o3Compiled = compileForModel('o3-mini', ir);
assert(o3Compiled.target === 'openai', 'Detected OpenAI target for o3-mini');
assert(o3Compiled.parameters.temperature === undefined, 'Stripped temperature for o3-mini');
assert(o3Compiled.stripped.some(s => s.key === 'temperature'), 'Records temperature in stripped audit ledger');

const ollamaCompiled = compileForModel('ollama', ir);
assert(ollamaCompiled.parameters.typical_p === undefined, 'Stripped typical_p for Ollama');
assert(ollamaCompiled.stripped.some(s => s.key === 'typical_p'), 'Records typical_p in stripped audit ledger');

// 7. Invariant I5: In-Chat Agent Template Immunity
console.log('\n--- Test 7: Invariant I5 (Agent Template Immunity) ---');
const tplPath = path.resolve('templates/tpl-sb-picor-doctor.json');
const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf-8'));
assert(tpl.context_policy.includeSystemPrompt === false, 'Template has includeSystemPrompt: false');
assert(tpl.context_policy.includePersona === false, 'Template has includePersona: false');
assert(tpl.context_policy.includeCharacterCard === false, 'Template has includeCharacterCard: false');

console.log('\n====================================================');
console.log(`Alpha 2 Test Results: ${passed}/${total} assertions passed.`);
console.log('====================================================\n');

if (passed !== total) {
    process.exit(1);
}
