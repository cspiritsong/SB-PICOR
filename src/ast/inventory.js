/**
 * SB-PICOR - Milestone 1: Preset & Prompt Presence & Inventory
 * 
 * Inspects a SillyTavern/SillyBunny preset JSON file:
 * - Validates schema and top-level settings.
 * - Resolves active prompt_order (supports default 100000 and custom character/order slots).
 * - Distinguishes enabled vs disabled prompt blocks.
 * - Identifies documentation prompts (README, Advice) and visual UI dividers.
 * - Measures character counts and estimated token weight.
 */

import fs from 'fs';
import path from 'path';

// Known UI divider patterns used by preset authors
const DIVIDER_PATTERNS = [
    /^[─━—=\-]{3,}/,
    /^(?:[^a-zA-Z0-9\s]+\s*)?[─━—\-]\+/,
    /^🌱\s*━\+/,
    /^=+\+?=+/,
];

// Known documentation / metadata labels
const DOC_PATTERNS = [
    /readme/i,
    /sampling advice/i,
    /instructions/i,
    /guide/i,
    /author note/i,
];

/**
 * Inspect a preset JSON object or file path.
 * @param {string|object} input - File path or parsed JSON object
 * @param {number} [targetCharacterId=100000] - Target character_id in prompt_order (100000 is default)
 * @returns {object} Structured inventory report
 */
export function inspectPreset(input, targetCharacterId = 100000) {
    let raw;
    let filePath = null;

    if (typeof input === 'string') {
        filePath = path.resolve(input);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Preset file not found: ${filePath}`);
        }
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        raw = JSON.parse(fileContent);
    } else if (typeof input === 'object' && input !== null) {
        raw = input;
    } else {
        throw new Error('Invalid input: expected file path string or JSON object');
    }

    // 1. Map all defined prompts by identifier
    const allPrompts = Array.isArray(raw.prompts) ? raw.prompts : [];
    const promptMap = new Map();
    for (const p of allPrompts) {
        if (p && p.identifier) {
            promptMap.set(p.identifier, p);
        }
    }

    // 2. Resolve prompt_order
    const promptOrders = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
    let selectedOrderObj = promptOrders.find(o => o.character_id === targetCharacterId);
    if (!selectedOrderObj && promptOrders.length > 0) {
        // Fallback to the first available order if target ID not found
        selectedOrderObj = promptOrders[0];
    }

    const orderEntries = selectedOrderObj && Array.isArray(selectedOrderObj.order)
        ? selectedOrderObj.order
        : [];

    // 3. Classify prompts in the active order
    const orderedItems = [];
    let activeCharCount = 0;
    let disabledCharCount = 0;
    let dividerCount = 0;
    let docCount = 0;

    for (const entry of orderEntries) {
        const ident = entry.identifier;
        const isEnabled = entry.enabled !== false;
        const promptDef = promptMap.get(ident) || {};

        const name = promptDef.name || ident || 'Unnamed Prompt';
        const role = promptDef.role || 'system';
        const content = promptDef.content || '';
        const charLength = content.length;
        const estimatedTokens = Math.ceil(charLength / 4);

        // Check if it's a visual divider or documentation
        const isDivider = DIVIDER_PATTERNS.some(pat => pat.test(name)) || (charLength === 0 && /[─━—+=]/.test(name));
        const isDoc = DOC_PATTERNS.some(pat => pat.test(name));

        if (isDivider) dividerCount++;
        if (isDoc) docCount++;

        if (isEnabled) {
            activeCharCount += charLength;
        } else {
            disabledCharCount += charLength;
        }

        orderedItems.push({
            identifier: ident,
            name,
            role,
            enabled: isEnabled,
            charLength,
            estimatedTokens,
            isDivider,
            isDoc,
            contentSnippet: content.slice(0, 120).replace(/\n/g, ' '),
        });
    }

    // 4. Identify zombie prompts (defined in prompts array but never referenced in active order)
    const referencedIdentifiers = new Set(orderEntries.map(e => e.identifier));
    const zombiePrompts = [];
    let zombieCharCount = 0;

    for (const p of allPrompts) {
        if (!referencedIdentifiers.has(p.identifier)) {
            const charLength = (p.content || '').length;
            zombieCharCount += charLength;
            zombiePrompts.push({
                identifier: p.identifier,
                name: p.name || 'Unnamed',
                role: p.role || 'system',
                charLength,
                estimatedTokens: Math.ceil(charLength / 4),
            });
        }
    }

    // 5. Extract samplers & operational parameters
    const samplers = {
        temperature: raw.temperature ?? null,
        top_p: raw.top_p ?? null,
        top_k: raw.top_k ?? null,
        top_a: raw.top_a ?? null,
        min_p: raw.min_p ?? null,
        typical_p: raw.typical_p ?? null,
        frequency_penalty: raw.frequency_penalty ?? null,
        presence_penalty: raw.presence_penalty ?? null,
        repetition_penalty: raw.repetition_penalty ?? null,
        openai_max_context: raw.openai_max_context ?? null,
        openai_max_tokens: raw.openai_max_tokens ?? null,
        reasoning_effort: raw.reasoning_effort ?? null,
        show_thoughts: raw.show_thoughts ?? null,
        names_behavior: raw.names_behavior ?? null,
        custom_exclude_body: raw.custom_exclude_body ?? null,
    };

    return {
        filePath,
        totalPromptsDefined: allPrompts.length,
        totalOrderEntries: orderEntries.length,
        activeCharacterId: selectedOrderObj ? selectedOrderObj.character_id : null,
        summary: {
            enabledPrompts: orderedItems.filter(i => i.enabled && !i.isDivider).length,
            disabledPrompts: orderedItems.filter(i => !i.enabled).length,
            dividers: dividerCount,
            docBlocks: docCount,
            zombiePrompts: zombiePrompts.length,
            activeCharCount,
            activeEstimatedTokens: Math.ceil(activeCharCount / 4),
            disabledCharCount,
            disabledEstimatedTokens: Math.ceil(disabledCharCount / 4),
            zombieCharCount,
            zombieEstimatedTokens: Math.ceil(zombieCharCount / 4),
        },
        samplers,
        orderedItems,
        zombiePrompts,
    };
}

// CLI runner if executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    const targetFile = process.argv[2] || 'intel/presets/geechan-universal-v5.3-tinker-v3.json';
    const targetId = process.argv[3] ? parseInt(process.argv[3], 10) : 100000;
    
    console.log(`\n=== SB-PICOR: Preset Inventory Scanner ===`);
    console.log(`Target: ${targetFile} (character_id: ${targetId})\n`);

    try {
        const report = inspectPreset(targetFile, targetId);
        console.log(`Active Character ID: ${report.activeCharacterId}`);
        console.log(`Total Defined Prompts: ${report.totalPromptsDefined}`);
        console.log(`Total Items in Order:  ${report.totalOrderEntries}`);
        console.log(`\n--- Inventory Breakdown ---`);
        console.log(`  Enabled Real Prompts:  ${report.summary.enabledPrompts} (~${report.summary.activeEstimatedTokens} tokens, ${report.summary.activeCharCount} chars)`);
        console.log(`  Disabled Prompts:      ${report.summary.disabledPrompts} (~${report.summary.disabledEstimatedTokens} tokens, ${report.summary.disabledCharCount} chars)`);
        console.log(`  UI Dividers:           ${report.summary.dividers}`);
        console.log(`  Docs / Advice:         ${report.summary.docBlocks}`);
        console.log(`  Zombie (Unreferenced): ${report.summary.zombiePrompts} (~${report.summary.zombieEstimatedTokens} tokens, ${report.summary.zombieCharCount} chars)`);
        
        console.log(`\n--- Configured Samplers ---`);
        for (const [k, v] of Object.entries(report.samplers)) {
            if (v !== null) console.log(`  ${k}: ${v}`);
        }

        console.log(`\n--- Ordered Prompt Hierarchy (First 15) ---`);
        for (let i = 0; i < Math.min(15, report.orderedItems.length); i++) {
            const item = report.orderedItems[i];
            const state = item.enabled ? '✓ ON ' : '✗ OFF';
            const tag = item.isDivider ? '[DIVIDER]' : item.isDoc ? '[DOC]' : `[${item.role}]`;
            console.log(`  ${(i+1).toString().padStart(2)}. ${state} ${tag.padEnd(9)} ${item.name.padEnd(35)} (${item.charLength} chars)`);
        }
        if (report.orderedItems.length > 15) {
            console.log(`  ... and ${report.orderedItems.length - 15} more items`);
        }
    } catch (err) {
        console.error(`Error inspecting preset: ${err.message}`);
        process.exit(1);
    }
}
