/**
 * SB-PICOR - Milestone 3: Prompt Arrangement & Sequence Linter
 * 
 * Validates that prompt elements sit in the correct logical sequence:
 * 1. Post-history instructions must stay AFTER chat history (near bottom).
 * 2. Character identity & scenario must stay BEFORE chat history.
 * 3. Cache Prefix stability: Static system instructions must be at the top;
 *    dynamic macros ({{time}}, {{random}}) must not bust the top prefix cache.
 */

// Canonical expected ordering tiers (0 = top/static prefix, 1 = character grounding, 2 = lore/context, 3 = history, 4 = recency nudges)
const EXPECTED_TIERS = {
    // Tier 0: Static System Foundation
    main: 0,
    system_rules: 0,
    nsfw: 0,

    // Tier 1: Lore / World Info (Before)
    worldInfoBefore: 1,

    // Tier 2: Character Persona & Grounding
    charDescription: 2,
    charPersonality: 2,
    scenario: 2,
    enhanceDefinitions: 2,

    // Tier 3: Lore / World Info (After) & Dialogue Examples
    worldInfoAfter: 3,
    dialogueExamples: 3,

    // Tier 4: Dynamic Conversation Stream
    chatHistory: 4,

    // Tier 5: Recency Nudges & Post-History Constraints
    jailbreak: 5,
    postHistory: 5,
    nudge: 5,
};

// Macros that change dynamically across turns / swipes and bust the prompt cache
const DYNAMIC_CACHE_BUSTING_MACROS = [
    /\{\{time\}\}/i,
    /\{\{date\}\}/i,
    /\{\{random::/i,
    /\{\{dice::/i,
    /\{\{idle_duration\}\}/i,
];

/**
 * Audit the arrangement and order of prompts in a preset.
 * @param {Array<{identifier: string, name: string, enabled: boolean, content?: string}>} orderedItems
 * @returns {object} Arrangement audit report
 */
export function auditArrangement(orderedItems = []) {
    const issues = [];
    const cacheWarnings = [];

    // Filter only enabled items
    const activeList = orderedItems.filter(item => item.enabled !== false);

    let foundHistoryIndex = -1;
    let foundCharDescriptionIndex = -1;

    for (let i = 0; i < activeList.length; i++) {
        const item = activeList[i];
        const ident = item.identifier || '';

        if (ident === 'chatHistory') {
            foundHistoryIndex = i;
        }
        if (ident === 'charDescription') {
            foundCharDescriptionIndex = i;
        }
    }

    // 1. Check: Post-history / jailbreak placed BEFORE chat history
    if (foundHistoryIndex !== -1) {
        for (let i = 0; i < foundHistoryIndex; i++) {
            const item = activeList[i];
            const ident = item.identifier || '';
            const name = (item.name || '').toLowerCase();

            if (ident === 'jailbreak' || name.includes('post history') || name.includes('post-history')) {
                issues.push({
                    type: 'INVERTED_POST_HISTORY',
                    severity: 'HIGH',
                    identifier: ident,
                    promptName: item.name,
                    currentIndex: i,
                    historyIndex: foundHistoryIndex,
                    message: `Post-history instruction "${item.name}" is placed BEFORE chat history (index ${i} vs ${foundHistoryIndex}). This weakens recency steering and causes model to ignore instructions.`,
                    recommendation: 'Move post-history prompt below chatHistory.',
                });
            }
        }
    }

    // 2. Check: Character Description placed AFTER chat history
    if (foundHistoryIndex !== -1 && foundCharDescriptionIndex !== -1) {
        if (foundCharDescriptionIndex > foundHistoryIndex) {
            issues.push({
                type: 'INVERTED_CHARACTER_GROUNDING',
                severity: 'HIGH',
                identifier: 'charDescription',
                currentIndex: foundCharDescriptionIndex,
                historyIndex: foundHistoryIndex,
                message: 'Character Description is placed AFTER chat history. The model will not be grounded before reading messages and may parrot persona traits verbatim.',
                recommendation: 'Move charDescription above chatHistory.',
            });
        }
    }

    // 3. Cache Prefix Audit: Scan top static prompts (Tier 0) for dynamic macros
    for (let i = 0; i < Math.min(activeList.length, 3); i++) {
        const item = activeList[i];
        const content = item.content || '';

        for (const macroRegex of DYNAMIC_CACHE_BUSTING_MACROS) {
            const match = content.match(macroRegex);
            if (match) {
                cacheWarnings.push({
                    type: 'CACHE_PREFIX_BUSTED',
                    severity: 'MEDIUM',
                    promptName: item.name,
                    identifier: item.identifier,
                    macro: match[0],
                    message: `Top-level prompt "${item.name}" contains dynamic macro ${match[0]}. This changes every turn and invalidates the prompt prefix cache on Claude and DeepSeek, significantly increasing cost and latency.`,
                    recommendation: 'Move dynamic macro into post-history or context layer below the static cache boundary.',
                });
            }
        }
    }

    return {
        isOrderSane: issues.length === 0,
        issues,
        cacheWarnings,
        activeOrderCount: activeList.length,
    };
}
