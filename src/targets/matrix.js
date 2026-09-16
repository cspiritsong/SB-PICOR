/**
 * SB-PICOR Alpha 2 — Consolidated Target Compiler Matrix
 * =====================================================================
 * One canonical intermediate representation (IR), five target dialects.
 *
 *   anthropic — XML sectioning (<guidelines>, <dialogue_rules>),
 *               positive reframing of prohibitions, OOC bridge.
 *   openai    — Markdown headings, developer-role for o-series,
 *               parameter stripping for o1/o3, max_completion_tokens.
 *   google    — Consolidated systemInstruction, non-standard sampler
 *               stripping.
 *   deepseek  — Minimalist system prompt for R1, penalty safety caps
 *               for V3.
 *   local     — Ollama / vLLM clean profile (typical_p stripped).
 * =====================================================================
 */

export const MATRIX_VERSION = 'alpha-2';

export const TARGET_IDS = Object.freeze(['anthropic', 'openai', 'google', 'deepseek', 'local']);

export const OOC_BRIDGE_TEXT =
  'If the user speaks out of character (OOC), answer directly and briefly in plain language, then return to the scene on the next reply. Never continue the scene while an OOC question is unanswered.';

export const POSITIVE_ANCHOR_DEFAULT = 'in-character, in-scene prose';

/* ====================================================================== *
 * Small helpers
 * ====================================================================== */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('\n\n');
  if (isPlainObject(value)) {
    if (typeof value.content === 'string') return value.content;
    if (typeof value.text === 'string') return value.text;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function toLines(value) {
  const raw = asText(value);
  if (!raw.trim()) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => asText(entry).trim())
      .filter(Boolean)
      .flatMap((entry) => (entry.includes('\n') ? toLines(entry) : [entry]));
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

function titleize(id) {
  return String(id)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function lowerFirst(text) {
  const s = String(text ?? '');
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function firstSentence(text) {
  const body = String(text ?? '').trim();
  if (!body) return '';
  const match = body.match(/[^.!?\n]+[.!?]?/);
  return match ? match[0].trim() : body;
}

function collapse(text) {
  return String(text ?? '').replace(/[ \t]+/g, ' ').trim();
}

function xmlAttr(value) {
  return String(value ?? '')
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function xmlInline(value) {
  return String(value ?? '')
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function indentBlock(text, spaces) {
  const pad = ' '.repeat(spaces);
  return String(text ?? '')
    .split('\n')
    .map((line) => (line.trim() ? pad + line : line))
    .join('\n');
}

/* ====================================================================== *
 * Parameter canonicalization + policy engine
 * ====================================================================== */

const PARAM_ALIASES = Object.freeze({
  temperature: 'temperature',
  temp: 'temperature',
  top_p: 'top_p',
  topp: 'top_p',
  nucleus: 'top_p',
  top_k: 'top_k',
  topk: 'top_k',
  min_p: 'min_p',
  minp: 'min_p',
  typical_p: 'typical_p',
  typicalp: 'typical_p',
  tfs_z: 'tfs_z',
  tfsz: 'tfs_z',
  mirostat: 'mirostat',
  mirostat_tau: 'mirostat_tau',
  mirostat_eta: 'mirostat_eta',
  repeat_penalty: 'repeat_penalty',
  repeatpenalty: 'repeat_penalty',
  repetition_penalty: 'repetition_penalty',
  repetitionpenalty: 'repetition_penalty',
  presence_penalty: 'presence_penalty',
  presencepenalty: 'presence_penalty',
  frequency_penalty: 'frequency_penalty',
  frequencypenalty: 'frequency_penalty',
  max_tokens: 'max_tokens',
  maxtokens: 'max_tokens',
  max_completion_tokens: 'max_completion_tokens',
  maxcompletiontokens: 'max_completion_tokens',
  num_predict: 'num_predict',
  numpredict: 'num_predict',
  max_output_tokens: 'max_output_tokens',
  maxoutputtokens: 'max_output_tokens',
  stop: 'stop',
  stop_sequences: 'stop_sequences',
  stopsequences: 'stop_sequences',
  seed: 'seed',
  logit_bias: 'logit_bias',
  logitbias: 'logit_bias',
  logprobs: 'logprobs',
  top_logprobs: 'top_logprobs',
  n: 'n',
  candidate_count: 'candidate_count',
  candidatecount: 'candidate_count',
  guidance_scale: 'guidance_scale',
  response_format: 'response_format',
  reasoning_effort: 'reasoning_effort',
  stream: 'stream',
});

export function canonicalizeParams(params) {
  const canonical = {};
  const origins = {};
  if (!isPlainObject(params)) return { canonical, origins };
  for (const [rawKey, value] of Object.entries(params)) {
    const lowered = String(rawKey).toLowerCase().replace(/[-\s]+/g, '_');
    const key = PARAM_ALIASES[rawKey] ?? PARAM_ALIASES[lowered] ?? lowered;
    if (key in canonical) continue;
    canonical[key] = value;
    origins[key] = rawKey;
  }
  return { canonical, origins };
}

function applyParamPolicy(policy = {}, params = {}) {
  const { canonical } = canonicalizeParams(params);
  const kept = {};
  const stripped = [];
  const clamped = [];
  const warnings = [];

  const id = policy.id ?? 'target';
  const keep = Array.isArray(policy.keep) ? new Set(policy.keep) : null;
  const strip = new Set(policy.strip ?? []);
  const stripReasons = policy.stripReasons ?? {};

  for (const [key, value] of Object.entries(canonical)) {
    if (value === null || value === undefined) continue;

    if (strip.has(key)) {
      stripped.push({ key, value, reason: stripReasons[key] ?? `unsupported by ${id}` });
      continue;
    }
    if (keep && !keep.has(key)) {
      stripped.push({ key, value, reason: `outside the ${id} parameter surface` });
      continue;
    }
    const drop = policy.drop?.[key];
    if (drop && typeof drop.when === 'function' && drop.when(value)) {
      stripped.push({ key, value, reason: drop.reason ?? `dropped for ${id}` });
      continue;
    }
    kept[key] = value;
  }

  for (const [key, cap] of Object.entries(policy.caps ?? {})) {
    if (!(key in kept)) continue;
    const value = Number(kept[key]);
    if (!Number.isFinite(value)) continue;
    let next = value;
    if (typeof cap.min === 'number') next = Math.max(next, cap.min);
    if (typeof cap.max === 'number') next = Math.min(next, cap.max);
    if (next !== value) {
      clamped.push({ key, from: value, to: next, reason: cap.reason ?? `capped for ${id}` });
      kept[key] = next;
      warnings.push(`${key} clamped ${value} → ${next} (${cap.reason ?? id})`);
    }
  }

  const parameters = {};
  for (const [key, value] of Object.entries(kept)) {
    const renamed = policy.rename?.[key] ?? key;
    parameters[renamed] = value;
  }

  return { parameters, stripped, clamped, warnings };
}

/* ====================================================================== *
 * Positive reframing
 * ====================================================================== */

const KNOWN_REFRAMES = Object.freeze([
  {
    re: /\b(?:break(?:ing)? character|out of character|ooc|fourth wall)\b/i,
    replacement: 'Stay in character at all times and keep the fourth wall intact.',
  },
  {
    re: /\b(?:speak(?:ing)? for|control(?:ling)?|puppet(?:ing)?)\s+(?:the\s+)?(?:user|player)\b|\bnarrat(?:e|ing)\s+(?:the\s+)?(?:user|player)(?:'s)?\s+actions\b/i,
    replacement: 'Let the user direct their own character; describe only the world and your own character.',
  },
  {
    re: /\bsummari[sz](?:e|ing)\b/i,
    replacement: 'Render every event in full, in-scene prose.',
  },
  {
    re: /\brepeat(?:ing)?\s+(?:yourself|the same|itself)\b|\bloop(?:ing)?\b/i,
    replacement: 'Advance the scene with every reply so the story keeps moving.',
  },
  {
    re: /\bapolog(?:y|ies|ise|ize|ising|izing)\b/i,
    replacement: 'Keep the tone steady and fully in-world.',
  },
  {
    re: /\bemojis?\b/i,
    replacement: 'Use plain prose punctuation at all times.',
  },
  {
    re: /\b(?:meta[-\s]?comment|as an ai|language model)\b/i,
    replacement: 'Stay inside the fiction and never refer to yourself as a model.',
  },
]);

const NEGATION_LEAD_RE =
  /^(?:please\s+)?(?:do\s+not|don'?t|never|avoid|must\s+not|mustn'?t|should\s+not|shouldn'?t|stop|refrain\s+from|no)\s+/i;

function reframeSentence(sentence, anchor) {
  const lead = (sentence.match(/^\s*/) ?? [''])[0];
  const core = sentence.trim();
  if (!core) return sentence;

  const known = KNOWN_REFRAMES.find((entry) => entry.re.test(core));
  if (known) return lead + known.replacement;

  const neg = core.match(NEGATION_LEAD_RE);
  if (!neg) return sentence;

  const remainder = core.slice(neg[0].length).replace(/[.!?]+$/, '').trim();
  if (!remainder) return sentence;

  return `${lead}Prefer ${anchor} over ${lowerFirst(remainder)}.`;
}

/**
 * Convert prohibitions into positive behavioural directives.
 * `"Do not narrate my actions."` →
 * `"Prefer in-character, in-scene prose over narrating my actions."`
 */
export function reframeNegative(text, options = {}) {
  const anchor = options.anchor ?? POSITIVE_ANCHOR_DEFAULT;
  const input = String(text ?? '');
  if (!input.trim()) return input;

  return input
    .split(/\r?\n/)
    .map((line) => {
      const bullet = line.match(/^(\s*(?:[-*•]\s+|\d+[.)]\s+))/);
      const marker = bullet ? bullet[1] : '';
      const body = bullet ? line.slice(marker.length) : line;
      if (!body.trim()) return line;
      const sentences = body.match(/[^.!?]+[.!?]*/g) ?? [body];
      return marker + sentences.map((s) => reframeSentence(s, anchor)).join('');
    })
    .join('\n');
}

/**
 * Target transform: rewrite negations across guidelines, dialogue rules,
 * and (optionally) section bodies. Returns a new IR — inputs untouched.
 */
export function applyPositiveReframing(ir, options = {}) {
  const anchor = options.anchor ?? POSITIVE_ANCHOR_DEFAULT;
  const sections = options.reframeSections
    ? ir.sections.map((section) => ({ ...section, body: reframeNegative(section.body, { anchor }) }))
    : ir.sections.map((section) => ({ ...section }));

  return {
    ...ir,
    sections,
    guidelines: ir.guidelines.map((g) => reframeNegative(g, { anchor })),
    dialogueRules: ir.dialogueRules.map((r) => reframeNegative(r, { anchor })),
    meta: { ...ir.meta, reframed: true },
  };
}

/* ====================================================================== *
 * IR normalization
 * ====================================================================== */

const SECTION_ORDER = Object.freeze([
  'systemPrompt',
  'description',
  'personality',
  'scenario',
  'exampleDialogue',
  'postHistory',
]);

const SECTION_ALIASES = Object.freeze({
  systemPrompt: ['system_prompt', 'systemPrompt', 'system'],
  description: ['description', 'desc', 'charDescription'],
  personality: ['personality', 'persona', 'traits'],
  scenario: ['scenario', 'setting', 'world'],
  exampleDialogue: ['mes_example', 'example_dialogue', 'exampleDialogue', 'examples', 'messageExamples'],
  postHistory: ['post_history_instructions', 'postHistoryInstructions', 'postHistory', 'jailbreak'],
});

const SECTION_TITLES = Object.freeze({
  systemPrompt: 'System',
  description: 'Description',
  personality: 'Personality',
  scenario: 'Scenario',
  exampleDialogue: 'Example Dialogue',
  postHistory: 'Post-History Instructions',
  guidelines: 'Guidelines',
  dialogueRules: 'Dialogue Rules',
  oocBridge: 'Out-of-Character Handling',
});

const SECTION_TAGS = Object.freeze({
  systemPrompt: 'system',
  description: 'description',
  personality: 'personality',
  scenario: 'scenario',
  exampleDialogue: 'example_dialogue',
  postHistory: 'post_history_instructions',
  guidelines: 'guidelines',
  dialogueRules: 'dialogue_rules',
});

function sectionTag(id) {
  if (SECTION_TAGS[id]) return SECTION_TAGS[id];
  return String(id)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'section';
}

function flattenCard(input) {
  if (!isPlainObject(input)) return {};
  const out = {};
  if (isPlainObject(input.character)) Object.assign(out, input.character);
  if (isPlainObject(input.card)) Object.assign(out, input.card);
  if (isPlainObject(input.data)) Object.assign(out, input.data);
  Object.assign(out, input);
  return out;
}

function firstString(flat, keys) {
  for (const key of keys) {
    const value = flat[key];
    if (value === undefined || value === null) continue;
    const text = asText(value);
    if (text && text.trim()) return text.trim();
  }
  return '';
}

/**
 * Normalize any card / IR-shaped input into the canonical IR.
 */
export function normalizeIr(input = {}, options = {}) {
  const flat = flattenCard(input);

  const name = firstString(flat, ['name', 'char_name', 'charName', 'character', 'title']) || 'Character';

  const sections = [];

  if (Array.isArray(flat.sections) && flat.sections.length) {
    flat.sections.forEach((raw, index) => {
      const section = isPlainObject(raw) ? raw : { body: asText(raw) };
      const id = String(section.id ?? section.key ?? section.name ?? `section_${index}`);
      const body = asText(section.body ?? section.text ?? section.content ?? '').trim();
      if (!body) return;
      sections.push({
        id,
        title: section.title ?? SECTION_TITLES[id] ?? titleize(id),
        tag: section.tag ?? sectionTag(id),
        body,
      });
    });
  } else {
    for (const id of SECTION_ORDER) {
      const value = firstString(flat, SECTION_ALIASES[id] ?? [id]);
      if (!value) continue;
      sections.push({ id, title: SECTION_TITLES[id] ?? titleize(id), tag: sectionTag(id), body: value });
    }
  }

  /* Guidelines: explicit list, else lift from a guidelines/rules section. */
  let guidelines = toLines(flat.guidelines ?? flat.rules ?? flat.guidelines_list ?? null);
  if (!guidelines.length) {
    const index = sections.findIndex((s) => /^(?:guidelines?|rules?)$/i.test(s.id));
    if (index >= 0) {
      guidelines = toLines(sections[index].body);
      sections.splice(index, 1);
    }
  }

  const dialogueRules = toLines(flat.dialogue_rules ?? flat.dialogueRules ?? flat.dialogue ?? null);

  const greeting = firstString(flat, ['first_mes', 'firstMessage', 'first_message', 'greeting']);

  let messages = [];
  if (Array.isArray(flat.messages) && flat.messages.length) {
    messages = flat.messages
      .map((m) => (isPlainObject(m) ? { role: m.role ?? 'user', content: asText(m.content ?? m.text) } : null))
      .filter((m) => m && m.content);
  } else if (greeting && options.includeGreeting !== false) {
    messages = [{ role: 'assistant', content: greeting }];
  }

  let parameters = {};
  for (const key of ['parameters', 'params', 'sampler', 'samplers', 'config']) {
    if (isPlainObject(flat[key])) parameters = { ...parameters, ...flat[key] };
  }
  if (isPlainObject(options.parameters)) parameters = { ...parameters, ...options.parameters };

  const oocBridge =
    typeof flat.ooc_bridge === 'string'
      ? flat.ooc_bridge
      : flat.ooc_bridge === false
        ? null
        : OOC_BRIDGE_TEXT;

  return {
    id: String(flat.id ?? flat.cardId ?? name),
    name,
    sections,
    guidelines,
    dialogueRules,
    greeting,
    messages,
    parameters,
    oocBridge,
    meta: {
      version: MATRIX_VERSION,
      sections: sections.length,
      guidelines: guidelines.length,
      dialogueRules: dialogueRules.length,
      hasGreeting: Boolean(greeting),
      source: options.source ?? null,
    },
  };
}

/* ====================================================================== *
 * Shared renderers
 * ====================================================================== */

export function resolveOocBridge(ir, options = {}) {
  if (options.oocBridge === false) return null;
  if (typeof options.oocBridge === 'string') return options.oocBridge;
  return ir.oocBridge ?? OOC_BRIDGE_TEXT;
}

/** XML structure with <guidelines>, <dialogue_rules>, and <ooc_bridge>. */
export function renderXmlStructure(ir, options = {}) {
  const lines = [];
  lines.push(`<character name="${xmlAttr(ir.name)}">`);

  for (const section of ir.sections) {
    lines.push(`  <${section.tag}>`);
    lines.push(indentBlock(section.body, 4));
    lines.push(`  </${section.tag}>`);
  }

  if (ir.guidelines.length) {
    lines.push('  <guidelines>');
    for (const guideline of ir.guidelines) lines.push(`    <guideline>${xmlInline(guideline)}</guideline>`);
    lines.push('  </guidelines>');
  }

  if (ir.dialogueRules.length) {
    lines.push('  <dialogue_rules>');
    for (const rule of ir.dialogueRules) lines.push(`    <rule>${xmlInline(rule)}</rule>`);
    lines.push('  </dialogue_rules>');
  }

  const bridge = resolveOocBridge(ir, options);
  if (bridge) {
    lines.push('  <ooc_bridge>');
    lines.push(indentBlock(bridge, 4));
    lines.push('  </ooc_bridge>');
  }

  lines.push('</character>');
  return lines.join('\n');
}

/** Markdown heading structure with `##` sections. */
export function renderMarkdownStructure(ir, options = {}) {
  const lines = [`# ${ir.name}`, ''];

  for (const section of ir.sections) {
    lines.push(`## ${section.title}`, '', section.body, '');
  }

  if (ir.guidelines.length) {
    lines.push('## Guidelines', '');
    for (const guideline of ir.guidelines) lines.push(`- ${guideline}`);
    lines.push('');
  }

  if (ir.dialogueRules.length) {
    lines.push('## Dialogue Rules', '');
    for (const rule of ir.dialogueRules) lines.push(`- ${rule}`);
    lines.push('');
  }

  const bridge = resolveOocBridge(ir, options);
  if (bridge) {
    lines.push('## Out-of-Character Handling', '', bridge, '');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Consolidated plain-text block (Google / local runtimes). */
export function renderPlainStructure(ir, options = {}) {
  const lines = [];

  if (ir.name) lines.push(`${ir.name}`, '');

  for (const section of ir.sections) {
    lines.push(`${section.title}:`, section.body, '');
  }

  if (ir.guidelines.length) {
    lines.push('Guidelines:');
    for (const guideline of ir.guidelines) lines.push(`- ${guideline}`);
    lines.push('');
  }

  if (ir.dialogueRules.length) {
    lines.push('Dialogue Rules:');
    for (const rule of ir.dialogueRules) lines.push(`- ${rule}`);
    lines.push('');
  }

  const bridge = resolveOocBridge(ir, options);
  if (bridge) lines.push('Out-of-Character Handling:', bridge, '');

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Minimalist identity block for reasoning-first models (DeepSeek R1). */
export function renderMinimalStructure(ir, options = {}) {
  const lines = [`You are ${ir.name}.`];

  const anchorSection =
    ir.sections.find((s) => s.id === 'scenario') ??
    ir.sections.find((s) => s.id === 'description') ??
    ir.sections.find((s) => s.id === 'personality');

  const oneLiner = firstSentence(anchorSection?.body ?? '');
  if (oneLiner) lines.push(oneLiner);

  lines.push(options.minimalStyleRule ?? 'Write in-character prose and keep the scene moving with every reply.');

  const styleLine = ir.guidelines[0];
  if (styleLine) lines.push(firstSentence(styleLine));

  const bridge = resolveOocBridge(ir, options);
  if (bridge) lines.push(firstSentence(bridge));

  return lines.join('\n');
}

/* ====================================================================== *
 * Target detection
 * ====================================================================== */

const MODEL_HINTS = Object.freeze([
  ['deepseek', [/deepseek/i, /\br1\b/i, /reasoner/i]],
  ['anthropic', [/claude/i, /anthropic/i]],
  ['google', [/gemini/i, /palm/i, /gemma/i, /^google\//i]],
  ['openai', [/^gpt-?[3-9]/i, /^o[1-9]/i, /^chatgpt/i, /^text-davinci/i, /^gpt-/i]],
  ['local', [/llama/i, /mistral/i, /mixtral/i, /qwen/i, /phi-?/i, /yi-?/i, /falcon/i, /ollama/i, /vllm/i, /gguf/i, /\.ggml/i, /local/i]],
]);

export function detectTarget(modelId, fallback = 'openai') {
  const model = String(modelId ?? '').trim();
  if (!model) return fallback;
  for (const [target, patterns] of MODEL_HINTS) {
    if (patterns.some((re) => re.test(model))) return target;
  }
  return fallback;
}

/* ====================================================================== *
 * Envelope builder
 * ====================================================================== */

function emptyEnvelope(profile, options) {
  return {
    ok: true,
    version: MATRIX_VERSION,
    target: profile.id,
    label: profile.label,
    dialect: profile.dialect,
    model: options.model ?? null,
    role: profile.role ?? 'system',
    system: null,
    systemInstruction: null,
    messages: [],
    parameters: {},
    stripped: [],
    clamped: [],
    warnings: [],
    notes: [],
    meta: {
      generatedAt: new Date().toISOString(),
      sections: 0,
      guidelines: 0,
      dialogueRules: 0,
      reframed: false,
    },
  };
}

function finalizeEnvelope(profile, env, ir, rendered, paramResult, options) {
  return {
    ...env,
    role: rendered.role ?? env.role,
    system: rendered.system ?? env.system,
    systemInstruction: rendered.systemInstruction ?? env.systemInstruction,
    messages: rendered.messages ?? ir.messages ?? [],
    parameters: paramResult.parameters,
    stripped: paramResult.stripped,
    clamped: paramResult.clamped,
    warnings: [...(rendered.warnings ?? []), ...paramResult.warnings, ...(env.warnings ?? [])],
    notes: [...(profile.notes ?? []), ...(rendered.notes ?? [])],
    meta: {
      ...env.meta,
      sections: ir.sections.length,
      guidelines: ir.guidelines.length,
      dialogueRules: ir.dialogueRules.length,
      reframed: Boolean(ir.meta?.reframed),
      stage: rendered.stage ?? profile.id,
    },
  };
}

/* ====================================================================== *
 * Policies
 * ====================================================================== */

function messagesPolicy() {
  return {
    keep: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'max_tokens', 'stop', 'seed', 'logit_bias'],
    rename: {},
    caps: {
      temperature: { min: 0, max: 1, reason: 'Anthropic temperature range is 0–1' },
      top_p: { min: 0, max: 1, reason: 'nucleus sampling is bounded to 0–1' },
    },
    stripReasons: {
      frequency_penalty: 'not supported by the Anthropic Messages API',
      presence_penalty: 'not supported by the Anthropic Messages API',
      repetition_penalty: 'not supported by the Anthropic Messages API',
      typical_p: 'not supported by the Anthropic Messages API',
      tfs_z: 'not supported by the Anthropic Messages API',
      min_p: 'not supported by the Anthropic Messages API',
      mirostat: 'not supported by the Anthropic Messages API',
      mirostat_tau: 'not supported by the Anthropic Messages API',
      mirostat_eta: 'not supported by the Anthropic Messages API',
      n: 'not supported by the Anthropic Messages API',
    },
  };
}

function openAiChatPolicy(model) {
  return {
    id: `openai:${model || 'chat'}`,
    keep: [
      'temperature',
      'top_p',
      'frequency_penalty',
      'presence_penalty',
      'max_tokens',
      'stop',
      'seed',
      'logit_bias',
      'logprobs',
      'top_logprobs',
      'n',
      'response_format',
      'stream',
    ],
    caps: {
      temperature: { min: 0, max: 2, reason: 'OpenAI temperature range is 0–2' },
      top_p: { min: 0, max: 1, reason: 'nucleus sampling is bounded to 0–1' },
    },
    stripReasons: {
      typical_p: 'not supported by the OpenAI Chat Completions API',
      tfs_z: 'not supported by the OpenAI Chat Completions API',
      min_p: 'not supported by the OpenAI Chat Completions API',
      repetition_penalty: 'not supported by the OpenAI Chat Completions API',
      repeat_penalty: 'not supported by the OpenAI Chat Completions API',
      top_k: 'not supported by the OpenAI Chat Completions API',
      mirostat: 'not supported by the OpenAI Chat Completions API',
      mirostat_tau: 'not supported by the OpenAI Chat Completions API',
      mirostat_eta: 'not supported by the OpenAI Chat Completions API',
    },
  };
}

function openAiReasoningPolicy(model) {
  return {
    id: `openai-reasoning:${model || 'o-series'}`,
    keep: ['max_completion_tokens', 'stop', 'seed', 'reasoning_effort', 'stream'],
    rename: { max_tokens: 'max_completion_tokens' },
    stripReasons: {
      temperature: 'reasoning models ignore temperature',
      top_p: 'reasoning models ignore top_p',
      frequency_penalty: 'reasoning models reject frequency_penalty',
      presence_penalty: 'reasoning models reject presence_penalty',
      logprobs: 'reasoning models reject logprobs',
      top_logprobs: 'reasoning models reject top_logprobs',
      logit_bias: 'reasoning models reject logit_bias',
      n: 'reasoning models do not support n > 1',
      top_k: 'not supported by the OpenAI API',
      typical_p: 'not supported by the OpenAI API',
      tfs_z: 'not supported by the OpenAI API',
      min_p: 'not supported by the OpenAI API',
      repetition_penalty: 'not supported by the OpenAI API',
      repeat_penalty: 'not supported by the OpenAI API',
    },
  };
}

function googlePolicy() {
  return {
    id: 'google:generativelanguage',
    keep: ['temperature', 'top_p', 'top_k', 'max_output_tokens', 'stop_sequences', 'candidate_count', 'seed'],
    rename: {
      max_tokens: 'max_output_tokens',
      max_completion_tokens: 'max_output_tokens',
      stop: 'stop_sequences',
    },
    caps: {
      temperature: { min: 0, max: 2, reason: 'Gemini temperature range is 0–2' },
      top_p: { min: 0, max: 1, reason: 'nucleus sampling is bounded to 0–1' },
    },
    stripReasons: {
      frequency_penalty: 'no equivalent in the Gemini API — strip before sending',
      presence_penalty: 'no equivalent in the Gemini API — strip before sending',
      repetition_penalty: 'no equivalent in the Gemini API — strip before sending',
      typical_p: 'non-standard sampler for the Gemini API',
      tfs_z: 'non-standard sampler for the Gemini API',
      min_p: 'non-standard sampler for the Gemini API',
      mirostat: 'non-standard sampler for the Gemini API',
      mirostat_tau: 'non-standard sampler for the Gemini API',
      mirostat_eta: 'non-standard sampler for the Gemini API',
      logit_bias: 'no equivalent in the Gemini API — strip before sending',
      n: 'use candidate_count instead',
    },
  };
}

function deepseekV3Policy() {
  return {
    id: 'deepseek:v3',
    keep: ['temperature', 'top_p', 'max_tokens', 'stop', 'frequency_penalty', 'presence_penalty', 'logprobs', 'stream'],
    caps: {
      temperature: {
        min: 0,
        max: 1.5,
        reason: 'DeepSeek recommends 1.3 for general chat and 1.5 for creative writing; above 1.5 output degrades',
      },
      frequency_penalty: { min: 0, max: 1, reason: 'DeepSeek penalty safety cap' },
      presence_penalty: { min: 0, max: 1, reason: 'DeepSeek penalty safety cap' },
    },
    drop: {
      frequency_penalty: {
        when: (value) => !(Number(value) > 0),
        reason: 'DeepSeek V3 rejects frequency_penalty ≤ 0 in several API revisions — omit instead of zeroing',
      },
    },
    stripReasons: {
      top_k: 'not supported by the DeepSeek API',
      typical_p: 'not supported by the DeepSeek API',
      tfs_z: 'not supported by the DeepSeek API',
      min_p: 'not supported by the DeepSeek API',
      repetition_penalty: 'not supported by the DeepSeek API',
      repeat_penalty: 'not supported by the DeepSeek API',
      mirostat: 'not supported by the DeepSeek API',
      mirostat_tau: 'not supported by the DeepSeek API',
      mirostat_eta: 'not supported by the DeepSeek API',
      logit_bias: 'not supported by the DeepSeek API',
    },
  };
}

function deepseekR1Policy() {
  return {
    id: 'deepseek:r1',
    keep: ['max_tokens', 'stream'],
    stripReasons: {
      temperature: 'DeepSeek R1 ignores temperature — setting it is a documented footgun',
      top_p: 'DeepSeek R1 ignores top_p — setting it is a documented footgun',
      top_k: 'DeepSeek R1 ignores top_k',
      frequency_penalty: 'DeepSeek R1 ignores frequency_penalty',
      presence_penalty: 'DeepSeek R1 ignores presence_penalty',
      repetition_penalty: 'DeepSeek R1 ignores repetition_penalty',
      typical_p: 'not supported by DeepSeek R1',
      tfs_z: 'not supported by DeepSeek R1',
      min_p: 'not supported by DeepSeek R1',
      mirostat: 'not supported by DeepSeek R1',
      mirostat_tau: 'not supported by DeepSeek R1',
      mirostat_eta: 'not supported by DeepSeek R1',
      logprobs: 'not supported by DeepSeek R1',
      logit_bias: 'not supported by DeepSeek R1',
    },
  };
}

function localPolicy(runtime) {
  const ollama = runtime !== 'vllm';
  return {
    id: `local:${ollama ? 'ollama' : 'vllm'}`,
    keep: [
      'temperature',
      'top_p',
      'top_k',
      'min_p',
      ollama ? 'repeat_penalty' : 'repetition_penalty',
      ollama ? 'num_predict' : 'max_tokens',
      'stop',
      'seed',
    ],
    rename: ollama
      ? { max_tokens: 'num_predict', repetition_penalty: 'repeat_penalty', stop: 'stop' }
      : { num_predict: 'max_tokens', repeat_penalty: 'repetition_penalty', stop: 'stop' },
    caps: {
      temperature: { min: 0, max: 2, reason: 'local runtimes become incoherent above 2.0' },
    },
    stripReasons: {
      typical_p: 'stripped by the clean local profile — typical_p is a llama.cpp-era sampler that destabilises most modern GGUF quants',
      tfs_z: 'stripped by the clean local profile',
      mirostat: 'stripped by the clean local profile',
      mirostat_tau: 'stripped by the clean local profile',
      mirostat_eta: 'stripped by the clean local profile',
      guidance_scale: 'stripped by the clean local profile',
      frequency_penalty: 'not part of the local sampler surface',
      presence_penalty: 'not part of the local sampler surface',
      logit_bias: 'not part of the clean local profile',
    },
  };
}

/* ====================================================================== *
 * Target renderers
 * ====================================================================== */

export function isOpenAiReasoning(model) {
  const id = String(model ?? '');
  return /^o[1-9](\b|[-.])/i.test(id) || /-reasoning$/i.test(id) || /^o[1-9]$/i.test(id);
}

export function isDeepseekReasoning(model) {
  const id = String(model ?? '');
  if (!id) return false;
  if (/deepseek[^a-z0-9]*r1/i.test(id)) return true;
  if (/reasoner/i.test(id)) return true;
  return /^r1(\b|[-.])/i.test(id);
}

function renderAnthropic(ir, options) {
  const system = renderXmlStructure(ir, options);
  return {
    system,
    role: 'system',
    messages: ir.messages,
    warnings: [],
    notes: [
      'XML sectioning keeps Claude anchored to discrete card fields.',
      'Guidelines and dialogue rules are positively reframed before emission.',
      'The OOC bridge is emitted as <ooc_bridge> inside the character element.',
    ],
    stage: 'anthropic-xml',
  };
}

function renderOpenAi(ir, options) {
  const model = String(options.model ?? '');
  const reasoning = isOpenAiReasoning(model);
  const system = renderMarkdownStructure(ir, options);
  const warnings = [];
  const notes = [
    'Markdown headings mirror the card hierarchy and survive GPT tokenization cleanly.',
  ];

  if (reasoning) {
    warnings.push(
      'Reasoning model detected: temperature/top_p/penalties stripped, max_tokens mapped to max_completion_tokens, and the system block is delivered via the developer role.',
    );
    notes.push('Developer-role delivery used because the o-series honours instructions more reliably there.');
  } else {
    notes.push('System-role delivery with full sampler surface passed through.');
  }

  return {
    system,
    role: reasoning ? 'developer' : 'system',
    messages: ir.messages,
    warnings,
    notes,
    stage: reasoning ? 'openai-developer' : 'openai-system',
  };
}

function renderGoogle(ir, options) {
  const text = renderPlainStructure(ir, options);
  return {
    system: text,
    systemInstruction: { parts: [{ text }] },
    role: 'system',
    messages: ir.messages,
    warnings: [],
    notes: [
      'All sections consolidated into a single systemInstruction block.',
      'Non-standard samplers (frequency/presence penalty, logit_bias, typical_p) are stripped.',
    ],
    stage: 'google-consolidated',
  };
}

function renderDeepseek(ir, options) {
  const model = String(options.model ?? '');
  const reasoning = isDeepseekReasoning(model);

  if (reasoning) {
    const system = renderMinimalStructure(ir, options);
    return {
      system,
      role: 'system',
      messages: ir.messages,
      warnings: [
        'DeepSeek R1 degrades on long system prompts: the card was reduced to a minimal identity + behaviour block, and sampling parameters were stripped.',
      ],
      notes: [
        'If fidelity drops, move the full card text into the first user message and keep this system prompt unchanged.',
        'R1 handles the OOC bridge as a single sentence rather than a structured block.',
      ],
      stage: 'deepseek-r1-minimal',
    };
  }

  const system = renderMarkdownStructure(ir, options);
  return {
    system,
    role: 'system',
    messages: ir.messages,
    warnings: [],
    notes: [
      'V3 profile: penalties are safety-capped (temperature ≤ 1.5, frequency/presence ≤ 1.0).',
      'frequency_penalty values ≤ 0 are omitted rather than zeroed.',
    ],
    stage: 'deepseek-v3',
  };
}

function renderLocal(ir, options) {
  const runtime = options.runtime === 'vllm' ? 'vllm' : 'ollama';
  const system = renderPlainStructure(ir, options);
  return {
    system,
    role: 'system',
    messages: ir.messages,
    warnings: [],
    notes: [
      `Clean ${runtime} profile: typical_p, tfs_z, mirostat tails and guidance_scale are stripped.`,
      runtime === 'ollama'
        ? 'Parameter names mapped to the Ollama Modelfile vocabulary (num_predict, repeat_penalty).'
        : 'Parameter names mapped to the vLLM/OpenAI-compatible vocabulary (max_tokens, repetition_penalty).',
    ],
    chatTemplate: 'chatml',
    stage: `local-${runtime}`,
  };
}

/* ====================================================================== *
 * The matrix
 * ====================================================================== */

export const TARGET_MATRIX = Object.freeze({
  anthropic: Object.freeze({
    id: 'anthropic',
    label: 'Anthropic Claude',
    dialect: 'xml',
    role: 'system',
    models: [/claude/i, /anthropic/i],
    policy: messagesPolicy(),
    notes: ['Anthropic performs best with explicit XML section boundaries and positively framed rules.'],
    transforms: Object.freeze({
      structure: 'xml',
      reframe: applyPositiveReframing,
      oocBridge: resolveOocBridge,
      positiveReframing: true,
    }),
    resolvePolicy() {
      return messagesPolicy();
    },
    render: renderAnthropic,
  }),

  openai: Object.freeze({
    id: 'openai',
    label: 'OpenAI GPT / o-series',
    dialect: 'markdown',
    role: 'system',
    models: [/^gpt-?[3-9]/i, /^o[1-9]/i],
    policy: openAiChatPolicy('default'),
    notes: ['Markdown sectioning; reasoning models switch to the developer role automatically.'],
    transforms: Object.freeze({
      structure: 'markdown',
      developerRole: true,
      stripReasoningParams: true,
      maxCompletionTokens: true,
      oocBridge: resolveOocBridge,
    }),
    resolvePolicy(options) {
      return isOpenAiReasoning(options.model) ? openAiReasoningPolicy(options.model) : openAiChatPolicy(options.model);
    },
    render: renderOpenAi,
  }),

  google: Object.freeze({
    id: 'google',
    label: 'Google Gemini',
    dialect: 'plain',
    role: 'system',
    models: [/gemini/i, /palm/i, /gemma/i],
    policy: googlePolicy(),
    notes: ['Consolidated systemInstruction with the non-standard sampler surface removed.'],
    transforms: Object.freeze({
      structure: 'consolidated-systemInstruction',
      stripNonStandardSamplers: true,
      oocBridge: resolveOocBridge,
    }),
    resolvePolicy() {
      return googlePolicy();
    },
    render: renderGoogle,
  }),

  deepseek: Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek V3 / R1',
    dialect: 'markdown',
    role: 'system',
    models: [/deepseek/i, /reasoner/i],
    policy: deepseekV3Policy(),
    notes: ['R1 switches to a minimalist system prompt; V3 keeps the full structure with capped penalties.'],
    transforms: Object.freeze({
      structure: 'minimal-for-r1',
      minimalReasoningPrompt: true,
      penaltySafetyCaps: true,
      oocBridge: resolveOocBridge,
    }),
    resolvePolicy(options) {
      return isDeepseekReasoning(options.model) ? deepseekR1Policy() : deepseekV3Policy();
    },
    render: renderDeepseek,
  }),

  local: Object.freeze({
    id: 'local',
    label: 'Local (Ollama / vLLM)',
    dialect: 'plain',
    role: 'system',
    models: [/llama/i, /mistral/i, /qwen/i, /ollama/i, /vllm/i],
    policy: localPolicy('ollama'),
    notes: ['Clean local profile: typical_p and the llama.cpp-era sampler tail are stripped.'],
    transforms: Object.freeze({
      structure: 'plain',
      stripTypicalP: true,
      runtimeParamNaming: true,
      oocBridge: resolveOocBridge,
    }),
    resolvePolicy(options) {
      return localPolicy(options?.runtime);
    },
    render: renderLocal,
  }),
});

export function listTargets() {
  return TARGET_IDS.map((id) => {
    const profile = TARGET_MATRIX[id];
    return { id: profile.id, label: profile.label, dialect: profile.dialect };
  });
}

function resolveProfile(targetId, options) {
  const id = String(targetId ?? '').trim().toLowerCase();
  if (TARGET_MATRIX[id]) return TARGET_MATRIX[id];
  if (options.strict === true) {
    throw new Error(`Unknown target "${targetId}". Known targets: ${TARGET_IDS.join(', ')}`);
  }
  return TARGET_MATRIX[detectTarget(options.model, 'openai')];
}

/* ====================================================================== *
 * Public compile API
 * ====================================================================== */

/**
 * Compile an IR (or a raw card) for one target dialect.
 *
 * @param {string} targetId  anthropic | openai | google | deepseek | local
 * @param {object|string} irInput  Canonical IR or a raw card object.
 * @param {object} [options]  { model, runtime, oocBridge, anchor, parameters, strict }
 */
export function compileForTarget(targetId, irInput = {}, options = {}) {
  const profile = resolveProfile(targetId, options);
  const normalized = normalizeIr(irInput, options);

  const shouldReframe =
    options.positiveReframing === true ||
    (options.positiveReframing !== false && profile.transforms?.positiveReframing === true);

  const ir = shouldReframe
    ? applyPositiveReframing(normalized, {
        anchor: options.anchor ?? (profile.id === 'anthropic' ? POSITIVE_ANCHOR_DEFAULT : undefined),
        reframeSections: options.reframeSections === true,
      })
    : normalized;

  const rendered = profile.render(ir, options) ?? {};
  const policy = typeof profile.resolvePolicy === 'function' ? profile.resolvePolicy(options) : profile.policy;
  const paramResult = applyParamPolicy(policy, ir.parameters);

  const env = emptyEnvelope(profile, options);
  return finalizeEnvelope(profile, env, ir, rendered, paramResult, options);
}

/** Compile the same IR against every target in the matrix. */
export function compileMatrix(irInput = {}, options = {}) {
  const out = {};
  for (const id of TARGET_IDS) out[id] = compileForTarget(id, irInput, options);
  return out;
}

/** Convenience: auto-detect the target from the model id, then compile. */
export function compileForModel(model, irInput = {}, options = {}) {
  const target = options.target ?? detectTarget(model, 'openai');
  return compileForTarget(target, irInput, { ...options, model });
}

export const transforms = Object.freeze({
  reframeNegative,
  applyPositiveReframing,
  renderXmlStructure,
  renderMarkdownStructure,
  renderPlainStructure,
  renderMinimalStructure,
  resolveOocBridge,
  canonicalizeParams,
});

export default {
  MATRIX_VERSION,
  TARGET_IDS,
  TARGET_MATRIX,
  OOC_BRIDGE_TEXT,
  listTargets,
  detectTarget,
  normalizeIr,
  reframeNegative,
  applyPositiveReframing,
  resolveOocBridge,
  renderXmlStructure,
  renderMarkdownStructure,
  renderPlainStructure,
  renderMinimalStructure,
  compileForTarget,
  compileMatrix,
  compileForModel,
  isOpenAiReasoning,
  isDeepseekReasoning,
  transforms,
};
