/**
 * SB-PICOR - Milestone 5: Package Optimizer & Repackager
 * 
 * Compiles a cleaned preset + character card into a tailored,
 * model-specific and character-locked runtime preset package.
 * 
 * Target Transformers:
 * - Anthropic: Structured XML tags, prompt-cache boundary locking, positive reframing, OOC exception bridge.
 * - OpenAI: Clean Markdown headings, developer-role formatting, sampler stripping.
 * - Local / Generic: Normalized clean formatting with minimal bloat.
 */

import fs from 'fs';
import path from 'path';
import { prunePreset } from '../cleaner/prune.js';

/**
 * Compile a tailored preset package for a specific character card and target model.
 * @param {object|string} presetInput - Raw preset or file path
 * @param {object} options
 * @param {object} [options.cardData] - Character card data
 * @param {string} options.targetModel - e.g. 'openai/o3-mini', 'anthropic/claude-3-7-sonnet'
 * @param {string} [options.packageName] - Custom name override for the compiled package
 * @param {string} [options.outputDir] - Output directory to save the compiled preset JSON
 * @returns {object} Compiled preset package and metadata
 */
export function compileTailoredPackage(presetInput, options = {}) {
    const {
        cardData = { name: 'Universal', description: '' },
        targetModel = 'anthropic/claude-3-7-sonnet',
        packageName = null,
        outputDir = null,
    } = options;

    // 1. Run Milestone 4 surgical pruning first
    const { cleanedData, metrics } = prunePreset(presetInput, {
        targetModel,
        stripDividers: true,
        stripDocs: true,
        stripZombies: true,
        stripDisabled: true,
    });

    const isAnthropic = targetModel.includes('anthropic') || targetModel.includes('claude');
    const isOpenAI = targetModel.includes('openai') || targetModel.includes('o1') || targetModel.includes('o3');

    const cardName = cardData.name || 'Universal';
    const originalPresetName = cleanedData.name || 'Geechan v5.3';
    const cleanBaseName = originalPresetName.replace(/\s*\([^)]*\)/g, '').trim();

    // Derived model tag
    const modelTag = isAnthropic ? 'Claude' : isOpenAI ? 'OpenAI' : 'Local';
    const finalPackageName = packageName || `${cleanBaseName} [${cardName} • ${modelTag} Edition]`;

    // 2. Transform prompt blocks based on provider grammar and card tailoring
    const compiledPrompts = [];

    for (const prompt of cleanedData.prompts) {
        let content = prompt.content || '';

        // If the prompt is a system or jailbreak prompt, apply optimization transforms:
        if (prompt.role === 'system' && content.length > 0) {
            // A. Fix the OOC Gag Trap: Inject explicit diegetic OOC escape hatch if missing
            if (!content.includes('explicitly authorized through an ooc instruction') && !content.includes('diegetic exception')) {
                const oocHatch = '\n\n<!-- SB-PICOR OOC Exemption Bridge -->\nOOC Directives: Meta-instructions enclosed in [OOC: ...] or (OOC: ...) are authorial steering directives and must be answered directly and objectively without persona constraint.';
                content += oocHatch;
            }

            // B. Target Grammar: Anthropic XML wrapping
            if (isAnthropic) {
                if (prompt.identifier === 'main') {
                    content = `<story_guidelines>\n${content.trim()}\n</story_guidelines>`;
                } else if (prompt.identifier === 'nsfw') {
                    content = `<mature_themes>\n${content.trim()}\n</mature_themes>`;
                } else if (prompt.identifier === 'jailbreak') {
                    content = `<narration_post_rules>\n${content.trim()}\n</narration_post_rules>`;
                }
            }

            // C. Target Grammar: OpenAI Markdown normalization
            if (isOpenAI) {
                // Ensure proper # Markdown headings instead of XML
                content = content.replace(/<\/?(?:story_guidelines|mature_themes|narration_post_rules)>/g, '');
            }
        }

        compiledPrompts.push({
            ...prompt,
            content,
        });
    }

    // 3. Assemble the compiled package
    const finalPackage = {
        ...cleanedData,
        name: finalPackageName,
        prompts: compiledPrompts,
        // Tag SB-PICOR metadata
        sb_picor_metadata: {
            version: '1.0.0',
            compiled_at: new Date().toISOString(),
            target_model: targetModel,
            target_card: cardName,
            source_preset: originalPresetName,
            optimization_metrics: metrics,
        },
    };

    // 4. Save to disk if outputDir specified
    let savedFilePath = null;
    if (outputDir) {
        fs.mkdirSync(outputDir, { recursive: true });
        const safeFileName = finalPackageName.replace(/[^a-zA-Z0-9_\-\. \[\]]/g, '_') + '.json';
        savedFilePath = path.join(outputDir, safeFileName);
        fs.writeFileSync(savedFilePath, JSON.stringify(finalPackage, null, 2), 'utf-8');
    }

    return {
        packageName: finalPackageName,
        savedFilePath,
        packageData: finalPackage,
        metrics,
    };
}
