/**
 * SB-PICOR - Milestone 2: Card Instruction & Constraint Linter
 * 
 * Inspects Character Cards and Preset Prompts for "weird" and conflicting behavior:
 * 1. The "OOC Gag Trap" - Directives that prevent the AI from answering out-of-character debug queries.
 * 2. Negative Constraint Overdose - Excessive negative rules causing model fatigue and loop glitches.
 * 3. Perspective / POV Collisions - First-person vs. Third-person mandate clashes.
 * 4. Formatting Conflicts - XML requirement clashes, dialogue wrapper clashes.
 */

// Patterns that trigger the OOC Gag Trap
const OOC_GAG_PATTERNS = [
    {
        pattern: /(?:never|under no circumstances|do not|refrain from)\s+(?:break character|leave character|stop roleplaying|step out of character)/i,
        label: 'Strict Character Lock',
        description: 'Forbids breaking character under any circumstances. Gags the model when user asks meta/debug questions in chat.',
    },
    {
        pattern: /(?:never|under no circumstances|do not|refrain from)\s+(?:acknowledge (?:being|that you are) an? (?:ai|assistant|language model)|admit to being an? (?:ai|bot))/i,
        label: 'AI Identity Denial',
        description: 'Forbids acknowledging AI identity. Causes cryptic denials or loops when asked OOC questions.',
    },
    {
        pattern: /(?:never|under no circumstances|do not|strictly forbid[a-z]*)\s+(?:speak for|act for|write for|narrate for|control)\s+(?:\{\{user\}\}|user|the user)/i,
        label: 'Strict User Action Forbid',
        description: 'Forbids speaking for {{user}}. If user asks an OOC question without context, model may refuse to respond.',
    },
];

function getNegativeConstraintRegex() {
    return /\b(?:never|do not|don't|must not|cannot|should not|under no circumstances|forbidden|prohibited|refrain from|strictly avoid)\b/gi;
}

// Patterns indicating POV preferences
const FIRST_PERSON_PATTERNS = [
    /\b(?:first-person|first person|use 'I'|speak as 'I'|narrate from 'I'|from my perspective)\b/i,
];
const THIRD_PERSON_PATTERNS = [
    /\b(?:third-person|third person|use third-person limited|he\/she|refer to {{char}} by name)\b/i,
];

/**
 * Audit active preset prompts and character card text for conflicts and anomalies.
 * @param {Array<{name: string, content: string, role: string, identifier: string}>} activePrompts
 * @param {object} [cardData] - Character card data (description, scenario, personality, mes_example, etc.)
 * @returns {object} Card and constraint audit report
 */
export function auditCardAndConstraints(activePrompts = [], cardData = null) {
    const oocGagRisks = [];
    const negativeConstraints = [];
    const collisions = [];

    // 1. Audit Active Preset Prompts for OOC Gag risks & Negative Constraints
    for (const p of activePrompts) {
        const text = p.content || '';
        if (!text) continue;

        // Check OOC Gag patterns
        for (const rule of OOC_GAG_PATTERNS) {
            const match = text.match(rule.pattern);
            if (match) {
                oocGagRisks.push({
                    source: `Preset Prompt: "${p.name}" (${p.identifier})`,
                    ruleLabel: rule.label,
                    matchedSnippet: match[0],
                    description: rule.description,
                    recommendation: 'Isolate or strip during diagnostic/OOC turns.',
                });
            }
        }

        // Count negative constraints
        const negMatches = text.match(getNegativeConstraintRegex());
        if (negMatches) {
            negativeConstraints.push({
                promptName: p.name,
                identifier: p.identifier,
                count: negMatches.length,
                matches: Array.from(new Set(negMatches.map(m => m.toLowerCase()))),
            });
        }
    }

    // 2. Audit Character Card if provided
    let cardNegativeCount = 0;
    if (cardData) {
        const cardTextFields = [
            { field: 'description', text: cardData.description || '' },
            { field: 'personality', text: cardData.personality || '' },
            { field: 'scenario', text: cardData.scenario || '' },
            { field: 'post_history_instructions', text: cardData.post_history_instructions || '' },
            { field: 'system_prompt', text: cardData.system_prompt || '' },
        ];

        for (const item of cardTextFields) {
            if (!item.text) continue;

            // Check OOC Gag in card fields
            for (const rule of OOC_GAG_PATTERNS) {
                const match = item.text.match(rule.pattern);
                if (match) {
                    oocGagRisks.push({
                        source: `Character Card: [${item.field}]`,
                        ruleLabel: rule.label,
                        matchedSnippet: match[0],
                        description: rule.description,
                        recommendation: 'Remove from card post-history or isolate during OOC.',
                    });
                }
            }

            // Count negative constraints in card
            const cardMatches = item.text.match(getNegativeConstraintRegex());
            if (cardMatches) {
                cardNegativeCount += cardMatches.length;
            }
        }

        // 3. Cross-Check Collisions between Card and Preset
        const combinedCardText = cardTextFields.map(f => f.text).join(' ');
        const combinedPresetText = activePrompts.map(p => p.content || '').join(' ');

        // Check Perspective clash
        const cardWantsFirst = FIRST_PERSON_PATTERNS.some(p => p.test(combinedCardText));
        const presetWantsThird = THIRD_PERSON_PATTERNS.some(p => p.test(combinedPresetText));
        const cardWantsThird = THIRD_PERSON_PATTERNS.some(p => p.test(combinedCardText));
        const presetWantsFirst = FIRST_PERSON_PATTERNS.some(p => p.test(combinedPresetText));

        if (cardWantsFirst && presetWantsThird) {
            collisions.push({
                type: 'PERSPECTIVE_CLASH',
                severity: 'HIGH',
                cardRule: 'Card requests First-Person perspective ("I/me").',
                presetRule: 'Preset requests Third-Person narration ("he/she/they").',
                resolution: 'Override preset narration rule to match card preference.',
            });
        } else if (cardWantsThird && presetWantsFirst) {
            collisions.push({
                type: 'PERSPECTIVE_CLASH',
                severity: 'HIGH',
                cardRule: 'Card requests Third-Person perspective.',
                presetRule: 'Preset forces First-Person narration.',
                resolution: 'Override preset narration rule to match card preference.',
            });
        }
    }

    const totalPresetNegatives = negativeConstraints.reduce((acc, curr) => acc + curr.count, 0);
    const totalNegatives = totalPresetNegatives + cardNegativeCount;
    const isFatigued = totalNegatives >= 12;

    return {
        hasOocGagRisk: oocGagRisks.length > 0,
        oocGagRisks,
        negativeConstraintStats: {
            totalNegativeConstraints: totalNegatives,
            presetNegativeConstraints: totalPresetNegatives,
            cardNegativeConstraints: cardNegativeCount,
            isFatigued,
            warning: isFatigued ? `Found ${totalNegatives} negative constraints. High density causes prompt confusion and loop breakdowns.` : null,
            breakdown: negativeConstraints,
        },
        collisions,
    };
}
