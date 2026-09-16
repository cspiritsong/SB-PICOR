/**
 * SB-PICOR - SillyBunny / SillyTavern Extension Entrypoint
 * 
 * Standalone Extension: Preset & Character Card Doctor Agent
 * Features:
 * - Line-number precision forensic diagnostics.
 * - Catches OOC Gag Traps in cards and presets.
 * - Catches unsupported model wire samplers before HTTP 400 crashes.
 * - Non-destructive one-click fixes and lean preset compilation.
 */

import { getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { POPUP_TYPE, callGenericPopup } from '../../../popup.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

import { inspectPreset } from './src/ast/inventory.js';
import { auditWireCompatibility } from './src/linter/wire-audit.js';
import { auditCardAndConstraints } from './src/linter/card-audit.js';
import { auditArrangement } from './src/linter/arrangement-audit.js';
import { prunePreset } from './src/cleaner/prune.js';
import { compileTailoredPackage } from './src/repackager/compile.js';

const MODULE_NAME = 'sb_picor';

/**
 * Execute the forensic diagnostic scan across active card, preset, and model.
 */
export async function runDiagnostic() {
    const context = getContext();
    const { characters, characterId, main_api } = context;

    const activeChar = characters && characterId !== undefined ? characters[characterId] : null;
    const charName = activeChar ? (activeChar.name || 'Active Character') : 'No Character Selected';

    // Retrieve active preset data
    // In ST/SB, active preset can be retrieved via context or promptManager
    const activePreset = context.preset || {};
    const presetName = context.preset_name || 'Active Preset';

    // Determine target model
    const targetModel = context.model || main_api || 'generic';

    // 1. Run Milestone 1: Inventory
    let inventory = null;
    try {
        inventory = inspectPreset(activePreset, 100000);
    } catch (e) {
        inventory = {
            totalPromptsDefined: 0,
            orderedItems: [],
            samplers: {},
            summary: {},
        };
    }

    // 2. Run Milestone 2: Wire Audit & Card Linter
    const wireReport = auditWireCompatibility(inventory.samplers, targetModel, inventory.summary?.activeEstimatedTokens || 0);
    const cardReport = auditCardAndConstraints(inventory.orderedItems, activeChar);

    // 3. Run Milestone 3: Arrangement Audit
    const orderReport = auditArrangement(inventory.orderedItems);

    // Render Diagnostic Modal HTML
    renderDiagnosticModal({
        charName,
        activeChar,
        presetName,
        targetModel,
        wireReport,
        cardReport,
        orderReport,
        inventory,
    });
}

/**
 * Render the forensic diagnostic modal with line-numbered cards.
 */
function renderDiagnosticModal(data) {
    const {
        charName,
        activeChar,
        presetName,
        targetModel,
        wireReport,
        cardReport,
        orderReport,
        inventory,
    } = data;

    let cardsHtml = '';

    // A. Report OOC Gag Traps
    if (cardReport.hasOocGagRisk) {
        for (const risk of cardReport.oocGagRisks) {
            cardsHtml += `
            <div class="sb-picor-card critical">
                <div class="sb-picor-card-title">
                    <span>⚠️ OOC Gag Trap Detected</span>
                    <span class="sb-picor-badge critical">Prevents OOC Help</span>
                </div>
                <div class="sb-picor-location">
                    📍 <strong>Location:</strong> ${risk.source}
                </div>
                <div class="sb-picor-snippet">"${escapeHtml(risk.matchedSnippet)}"</div>
                <div class="sb-picor-explanation">
                    ${risk.description} When you type <code>[OOC: ...]</code> in chat, the model reads this instruction and is forbidden from speaking as an AI or answering your troubleshooting query.
                </div>
                <div class="sb-picor-actions">
                    <button class="sb-picor-action-btn danger" data-action="mute-card-line" data-field="${escapeHtml(risk.source)}">
                        ✂️ Auto-Mute This Line in ${escapeHtml(charName)}
                    </button>
                </div>
            </div>`;
        }
    }

    // B. Report Wire Incompatibilities (HTTP 400 Crashers)
    if (!wireReport.isWireSafe) {
        for (const v of wireReport.violations) {
            cardsHtml += `
            <div class="sb-picor-card critical">
                <div class="sb-picor-card-title">
                    <span>❌ Unsupported Wire Parameter</span>
                    <span class="sb-picor-badge critical">HTTP 400 Crash</span>
                </div>
                <div class="sb-picor-location">
                    📍 <strong>Parameter:</strong> <code>${escapeHtml(v.parameter)} = ${escapeHtml(String(v.current_value))}</code> &nbsp;|&nbsp; <strong>Target:</strong> ${escapeHtml(wireReport.modelName)}
                </div>
                <div class="sb-picor-explanation">
                    ${v.reason} If sent, ${escapeHtml(wireReport.modelName)} will reject the generation request with a hard HTTP 400 error.
                </div>
                <div class="sb-picor-actions">
                    <button class="sb-picor-action-btn" data-action="strip-sampler" data-param="${escapeHtml(v.parameter)}">
                        ⚡ Strip '${escapeHtml(v.parameter)}' from Preset
                    </button>
                </div>
            </div>`;
        }
    }

    // C. Report Sequence / Arrangement Issues
    if (!orderReport.isOrderSane) {
        for (const issue of orderReport.issues) {
            cardsHtml += `
            <div class="sb-picor-card warning">
                <div class="sb-picor-card-title">
                    <span>⚠️ Inverted Prompt Order</span>
                    <span class="sb-picor-badge warning">Order Glitch</span>
                </div>
                <div class="sb-picor-location">
                    📍 <strong>Prompt:</strong> ${escapeHtml(issue.promptName)} (${escapeHtml(issue.identifier)})
                </div>
                <div class="sb-picor-explanation">
                    ${issue.message}
                </div>
                <div class="sb-picor-actions">
                    <button class="sb-picor-action-btn secondary" data-action="fix-order">
                        🔄 Restore Recommended Order
                    </button>
                </div>
            </div>`;
        }
    }

    // D. If completely clean!
    if (cardReport.oocGagRisks.length === 0 && wireReport.isWireSafe && orderReport.isOrderSane) {
        cardsHtml += `
        <div class="sb-picor-card success">
            <div class="sb-picor-card-title">
                <span>✓ All Clear!</span>
                <span class="sb-picor-badge info">Optimal</span>
            </div>
            <div class="sb-picor-explanation">
                No OOC gag traps, wire parameter conflicts, or arrangement glitches detected between <strong>${escapeHtml(charName)}</strong>, <strong>${escapeHtml(presetName)}</strong>, and <strong>${escapeHtml(wireReport.modelName)}</strong>.
            </div>
        </div>`;
    }

    // Milestone 5 Repackage Banner
    cardsHtml += `
    <div class="sb-picor-card" style="border-left-color: #8b5cf6;">
        <div class="sb-picor-card-title">
            <span>📦 Milestone 5: Tailored Preset Compilation</span>
            <span class="sb-picor-badge info">Optimization</span>
        </div>
        <div class="sb-picor-explanation">
            Compile a dedicated, lean preset tailored specifically for <strong>${escapeHtml(charName)}</strong> on <strong>${escapeHtml(wireReport.modelName)}</strong>. Removes dead revisions, optimizes prompt caching, and injects the OOC exemption bridge. Original master preset is untouched.
        </div>
        <div class="sb-picor-actions">
            <button class="sb-picor-action-btn" data-action="compile-package" style="background: #8b5cf6;">
                📦 Compile & Save [${escapeHtml(charName)} • ${escapeHtml(wireReport.modelName)} Edition]
            </button>
        </div>
    </div>`;

    const fullHtml = `
    <div class="sb-picor-modal">
        <div class="sb-picor-header">
            <h3>🩺 SB-PICOR Doctor</h3>
            <p>Diagnostic scan for <strong>${escapeHtml(charName)}</strong> &bull; Preset: <strong>${escapeHtml(presetName)}</strong> &bull; Model: <strong>${escapeHtml(wireReport.modelName)}</strong></p>
        </div>
        ${cardsHtml}
    </div>`;

    const dialog = $(fullHtml);

    // Event listeners for action buttons
    dialog.find('[data-action="compile-package"]').on('click', () => {
        try {
            const compiled = compileTailoredPackage(context.preset || {}, {
                cardData: activeChar || { name: charName },
                targetModel,
            });
            toastr.success(`Compiled tailored preset: ${compiled.packageName}`, 'SB-PICOR');
        } catch (err) {
            toastr.error(`Compilation failed: ${err.message}`, 'SB-PICOR');
        }
    });

    callGenericPopup(dialog, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Extension initialization hook.
 */
export async function init() {
    console.log('[SB-PICOR] Initializing Preset & Card Doctor extension...');

    // 1. Register Slash Commands
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'doctor',
            callback: () => runDiagnostic(),
            helpString: 'Run SB-PICOR diagnostic scan on active card, preset, and model.',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'picor',
            callback: () => runDiagnostic(),
            helpString: 'Run SB-PICOR diagnostic scan on active card, preset, and model.',
        }));
    } catch (e) {
        console.warn('[SB-PICOR] Slash commands registration skipped or already registered');
    }

    // 2. Inject UI Button into top navigation / extensions drawer
    const doctorBtn = $(`
        <div id="sb-picor-trigger-btn" class="menu_button sb-picor-btn" title="Run SB-PICOR Preset & Card Diagnostic">
            <i class="fa-solid fa-stethoscope"></i>
            <span>Doctor</span>
        </div>
    `);
    doctorBtn.on('click', () => runDiagnostic());

    // Append to top bar or extensions menu if present
    const targetNav = $('#top-bar, #extensions_menu, #left-nav');
    if (targetNav.length > 0) {
        targetNav.first().append(doctorBtn);
    }
}
