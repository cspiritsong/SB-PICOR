/**
 * SB-PICOR - Milestone 2: Wire Audit & Model Compatibility Checker
 * 
 * Takes extracted samplers from Milestone 1 and evaluates them against
 * target model capabilities:
 * - Identifies HTTP 400 crashers (parameters rejected by target API).
 * - Identifies token ceiling mismatches and required key renames.
 * - Flags degradation risks (e.g. over-bloated system prompts for DeepSeek R1).
 */

import fs from 'fs';
import path from 'path';

const CAPS_PATH = path.resolve(new URL('.', import.meta.url).pathname, 'model-caps.json');
const CAPS_DATA = JSON.parse(fs.readFileSync(CAPS_PATH, 'utf-8'));

/**
 * Audit preset samplers and prompt weight against a target model profile.
 * @param {object} samplers - Extracted samplers from inspectPreset()
 * @param {string} targetModel - Key from model-caps.json (e.g. 'openai/o3-mini', 'ollama/generic')
 * @param {number} [totalSystemTokens=0] - Estimated active system prompt tokens
 * @returns {object} Audit report with violations and recommendations
 */
export function auditWireCompatibility(samplers, targetModel, totalSystemTokens = 0) {
    const modelProfile = CAPS_DATA.models[targetModel];
    if (!modelProfile) {
        throw new Error(`Unknown target model profile: "${targetModel}". Available profiles: ${Object.keys(CAPS_DATA.models).join(', ')}`);
    }

    const violations = [];
    const warnings = [];
    const safePayload = {};

    const disallowed = new Set(modelProfile.disallowed_samplers || []);

    // 1. Check for hard wire crashers
    for (const [key, value] of Object.entries(samplers)) {
        if (value === null || value === undefined) continue;

        // Skip non-sampler metadata fields
        if (['custom_exclude_body', 'names_behavior'].includes(key)) continue;

        if (disallowed.has(key)) {
            // Check if value is truly active (e.g. top_k: 0 or penalties: 0 might still be forwarded on wire)
            violations.push({
                parameter: key,
                current_value: value,
                severity: modelProfile.crash_on_disallowed ? 'CRITICAL_HTTP_400' : 'WARNING',
                reason: `${modelProfile.name} does not allow '${key}' in generation requests.`,
            });
        } else {
            safePayload[key] = value;
        }
    }

    // 2. Check conditional rules (e.g. Claude with thinking active)
    if (modelProfile.conditional_rules) {
        if (samplers.show_thoughts || samplers.reasoning_effort) {
            const rule = modelProfile.conditional_rules.thinking_active;
            if (rule) {
                for (const dis of (rule.disallow || [])) {
                    if (samplers[dis] !== null && samplers[dis] !== undefined && samplers[dis] !== 0) {
                        violations.push({
                            parameter: dis,
                            current_value: samplers[dis],
                            severity: 'CRITICAL_HTTP_400',
                            reason: `When reasoning/thinking is active, ${modelProfile.name} rejects '${dis}'. ${rule.notes || ''}`,
                        });
                    }
                }
                if (rule.force_temperature && samplers.temperature !== rule.force_temperature) {
                    warnings.push({
                        parameter: 'temperature',
                        current_value: samplers.temperature,
                        recommended_value: rule.force_temperature,
                        reason: `When thinking is active, ${modelProfile.name} expects temperature to be ${rule.force_temperature}.`,
                    });
                }
            }
        }
    }

    // 3. Token parameter mapping (e.g. o1/o3 requiring max_completion_tokens)
    if (modelProfile.requires_max_completion_tokens) {
        if (samplers.openai_max_tokens) {
            warnings.push({
                parameter: 'openai_max_tokens',
                current_value: samplers.openai_max_tokens,
                mapped_parameter: 'max_completion_tokens',
                reason: `${modelProfile.name} requires 'max_completion_tokens' instead of 'max_tokens'.`,
            });
        }
    }

    // 4. System prompt budget checks (e.g. DeepSeek R1)
    if (modelProfile.max_recommended_system_tokens && totalSystemTokens > modelProfile.max_recommended_system_tokens) {
        warnings.push({
            parameter: 'system_tokens',
            current_value: totalSystemTokens,
            recommended_ceiling: modelProfile.max_recommended_system_tokens,
            reason: `${modelProfile.name} guidance warns that large system prompts (> ${modelProfile.max_recommended_system_tokens} tokens) degrade internal reasoning performance.`,
        });
    }

    return {
        targetModel,
        modelName: modelProfile.name,
        provider: modelProfile.provider,
        isWireSafe: violations.length === 0,
        violations,
        warnings,
        strippedParameters: violations.map(v => v.parameter),
        safePayload,
    };
}
