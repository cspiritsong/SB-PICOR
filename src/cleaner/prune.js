/**
 * SB-PICOR - Milestone 4: Preset Cleaner & Pruning Engine
 * 
 * Safely cleans a preset JSON without touching the original file:
 * 1. Prunes disabled revision history, older drafts, and unused experiments.
 * 2. Prunes visual UI dividers and documentation blocks (README, advice).
 * 3. Prunes zombie prompts not referenced in the active order.
 * 4. Strips model-illegal wire parameters for the target model.
 * 5. Returns a clean, lightweight preset object.
 */

import fs from 'fs';
import { inspectPreset } from '../ast/inventory.js';
import { auditWireCompatibility } from '../linter/wire-audit.js';

/**
 * Clean and prune a preset object.
 * @param {object|string} presetInput - Preset JSON object or file path
 * @param {object} options
 * @param {number} [options.characterId=100000] - Target character_id order
 * @param {string} [options.targetModel] - Target model key from model-caps.json
 * @param {boolean} [options.stripDividers=true] - Remove UI dividers
 * @param {boolean} [options.stripDocs=true] - Remove READMEs/Advice prompts
 * @param {boolean} [options.stripZombies=true] - Remove unreferenced prompts
 * @param {boolean} [options.stripDisabled=true] - Remove disabled prompts
 * @returns {object} Cleaned preset object and pruning metrics
 */
export function prunePreset(presetInput, options = {}) {
    const {
        characterId = 100000,
        targetModel = null,
        stripDividers = true,
        stripDocs = true,
        stripZombies = true,
        stripDisabled = true,
    } = options;

    // Run Milestone 1 inventory
    const inventory = inspectPreset(presetInput, characterId);
    
    // Deep clone original raw data
    const raw = typeof presetInput === 'string'
        ? JSON.parse(JSON.stringify(inventory.raw || JSON.parse(fs.readFileSync(presetInput, 'utf-8'))))
        : JSON.parse(JSON.stringify(presetInput));

    const originalCharCount = inventory.summary.activeCharCount + inventory.summary.disabledCharCount + inventory.summary.zombieCharCount;
    const originalPromptCount = inventory.totalPromptsDefined;

    // 1. Filter ordered items
    const retainedOrderEntries = [];
    const retainedPromptIdentifiers = new Set();
    let removedDividers = 0;
    let removedDocs = 0;
    let removedDisabled = 0;

    for (const item of inventory.orderedItems) {
        if (stripDividers && item.isDivider) {
            removedDividers++;
            continue;
        }
        if (stripDocs && item.isDoc) {
            removedDocs++;
            continue;
        }
        if (stripDisabled && !item.enabled) {
            removedDisabled++;
            continue;
        }

        retainedOrderEntries.push({
            identifier: item.identifier,
            enabled: true, // In a pruned preset, retained items are active
        });
        retainedPromptIdentifiers.add(item.identifier);
    }

    // 2. Filter the `prompts` array
    const originalPrompts = Array.isArray(raw.prompts) ? raw.prompts : [];
    const cleanedPrompts = originalPrompts.filter(p => {
        if (!p || !p.identifier) return false;
        return retainedPromptIdentifiers.has(p.identifier);
    });

    // 3. Construct cleaned prompt_order
    const cleanedPromptOrder = [
        {
            character_id: 100000, // Normalized to default
            order: retainedOrderEntries,
        },
    ];

    // 4. Clean samplers if target model is specified
    let strippedSamplers = [];
    let cleanedData = {
        ...raw,
        prompts: cleanedPrompts,
        prompt_order: cleanedPromptOrder,
    };

    if (targetModel) {
        const wireReport = auditWireCompatibility(inventory.samplers, targetModel, inventory.summary.activeEstimatedTokens);
        strippedSamplers = wireReport.strippedParameters;

        // Delete stripped keys from cleaned data
        for (const key of strippedSamplers) {
            delete cleanedData[key];
        }

        // Map max_completion_tokens if required
        if (wireReport.warnings.some(w => w.mapped_parameter === 'max_completion_tokens')) {
            cleanedData.max_completion_tokens = cleanedData.openai_max_tokens;
        }
    }

    // Measure new weights
    let cleanedCharCount = 0;
    for (const p of cleanedPrompts) {
        cleanedCharCount += (p.content || '').length;
    }

    const tokenReductionPct = originalCharCount > 0
        ? Math.round(((originalCharCount - cleanedCharCount) / originalCharCount) * 100)
        : 0;

    return {
        cleanedData,
        metrics: {
            originalPromptCount,
            cleanedPromptCount: cleanedPrompts.length,
            removedPromptsCount: originalPromptCount - cleanedPrompts.length,
            removedDividers,
            removedDocs,
            removedDisabled,
            originalCharCount,
            originalEstimatedTokens: Math.ceil(originalCharCount / 4),
            cleanedCharCount,
            cleanedEstimatedTokens: Math.ceil(cleanedCharCount / 4),
            tokenReductionPct,
            strippedSamplers,
            targetModel: targetModel || 'none',
        },
    };
}
