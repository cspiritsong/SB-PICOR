/**
 * SB-PICOR Alpha 2 — OOC Interceptor
 * =====================================================================
 * Section 1.4 state machine + heuristic intent classification + the
 * intercept handler that pauses character generation, aborts the live
 * stream, and prepares a diagnostic report for the doctor template.
 *
 * The interceptor is deliberately host-agnostic: every side effect is
 * routed through a tiny adapter object (`host`) whose methods are all
 * optional. Missing hooks degrade to no-ops instead of throwing, so the
 * module can be unit-tested with a bare `{}` host.
 *
 * Host adapter surface (all optional):
 *   abortGeneration(payload)          -> boolean | { aborted, fatal }
 *   emitSystemMessage(text, meta)     -> any
 *   emitDiagnostic(report)            -> any
 *   saveReport(report)                -> any
 *   log(level, message, meta)         -> any
 * =====================================================================
 */

import { auditCard } from '../linter/card-audit.js';

export const INTERCEPTOR_VERSION = 'alpha-2';

/* ====================================================================== *
 * 1. State machine (Section 1.4)
 * ====================================================================== */

export const OOC_STATES = Object.freeze({
  IDLE: 'IDLE',
  GENERATING: 'GENERATING',
  OOC_DETECTED: 'OOC_DETECTED',
  ABORTING: 'ABORTING',
  DIAGNOSING: 'DIAGNOSING',
  REPORTING: 'REPORTING',
  RESUMABLE: 'RESUMABLE',
  HALTED: 'HALTED',
});

export const OOC_EVENTS = Object.freeze({
  USER_TURN: 'USER_TURN',
  GENERATION_START: 'GENERATION_START',
  GENERATION_END: 'GENERATION_END',
  OOC_INTERCEPT: 'OOC_INTERCEPT',
  ABORT_REQUESTED: 'ABORT_REQUESTED',
  ABORT_COMPLETE: 'ABORT_COMPLETE',
  ABORT_FAILED: 'ABORT_FAILED',
  DIAGNOSTIC_READY: 'DIAGNOSTIC_READY',
  DIAGNOSTIC_FAILED: 'DIAGNOSTIC_FAILED',
  REPORT_EMITTED: 'REPORT_EMITTED',
  RESUME: 'RESUME',
  RESET: 'RESET',
  FAIL: 'FAIL',
});

/** Terminal escape hatches that are always legal from every state. */
const GLOBAL_TRANSITIONS = Object.freeze({
  [OOC_EVENTS.RESET]: OOC_STATES.IDLE,
  [OOC_EVENTS.FAIL]: OOC_STATES.HALTED,
});

const TRANSITIONS = Object.freeze({
  [OOC_STATES.IDLE]: {
    [OOC_EVENTS.USER_TURN]: OOC_STATES.IDLE,
    [OOC_EVENTS.GENERATION_START]: OOC_STATES.GENERATING,
  },
  [OOC_STATES.GENERATING]: {
    [OOC_EVENTS.USER_TURN]: OOC_STATES.GENERATING,
    [OOC_EVENTS.GENERATION_END]: OOC_STATES.IDLE,
    [OOC_EVENTS.OOC_INTERCEPT]: OOC_STATES.OOC_DETECTED,
  },
  [OOC_STATES.OOC_DETECTED]: {
    [OOC_EVENTS.ABORT_REQUESTED]: OOC_STATES.ABORTING,
    [OOC_EVENTS.ABORT_COMPLETE]: OOC_STATES.DIAGNOSING,
  },
  [OOC_STATES.ABORTING]: {
    [OOC_EVENTS.ABORT_COMPLETE]: OOC_STATES.DIAGNOSING,
    [OOC_EVENTS.ABORT_FAILED]: OOC_STATES.HALTED,
  },
  [OOC_STATES.DIAGNOSING]: {
    [OOC_EVENTS.DIAGNOSTIC_READY]: OOC_STATES.REPORTING,
    [OOC_EVENTS.DIAGNOSTIC_FAILED]: OOC_STATES.HALTED,
  },
  [OOC_STATES.REPORTING]: {
    [OOC_EVENTS.REPORT_EMITTED]: OOC_STATES.RESUMABLE,
  },
  [OOC_STATES.RESUMABLE]: {
    [OOC_EVENTS.RESUME]: OOC_STATES.IDLE,
    [OOC_EVENTS.USER_TURN]: OOC_STATES.IDLE,
    [OOC_EVENTS.OOC_INTERCEPT]: OOC_STATES.OOC_DETECTED,
  },
  [OOC_STATES.HALTED]: {},
});

export class OocTransitionError extends Error {
  constructor(from, event, allowed) {
    super(
      `Invalid OOC transition: cannot send "${event}" from ${from}. ` +
        `Allowed: ${allowed.length ? allowed.join(', ') : '(none)'}`,
    );
    this.name = 'OocTransitionError';
    this.from = from;
    this.event = event;
    this.allowed = allowed;
  }
}

export class OocStateMachine {
  constructor(sessionId = 'default', options = {}) {
    this.sessionId = String(sessionId ?? 'default');
    this.initial = options.initial ?? OOC_STATES.IDLE;
    this.state = this.initial;
    this.history = [];
    this.maxHistory = Number.isInteger(options.maxHistory) ? options.maxHistory : 64;
    this.listeners = new Set();
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;
  }

  /* -- internals ------------------------------------------------------ */

  #table() {
    return { ...(TRANSITIONS[this.state] ?? {}), ...GLOBAL_TRANSITIONS };
  }

  /* -- queries -------------------------------------------------------- */

  get allowedEvents() {
    return Object.keys(this.#table());
  }

  can(event) {
    return Object.prototype.hasOwnProperty.call(this.#table(), event);
  }

  /* -- mutation ------------------------------------------------------- */

  send(event, meta = {}) {
    const table = this.#table();
    if (!Object.prototype.hasOwnProperty.call(table, event)) {
      throw new OocTransitionError(this.state, event, Object.keys(table));
    }
    const from = this.state;
    const to = table[event];
    this.state = to;
    this.updatedAt = Date.now();

    const record = Object.freeze({ from, to, event, at: this.updatedAt, meta });
    this.history.push(record);
    if (this.history.length > this.maxHistory) this.history.shift();

    for (const listener of this.listeners) {
      try {
        listener(record, this);
      } catch {
        /* A broken observer must never wedge the machine. */
      }
    }
    return to;
  }

  trySend(event, meta = {}) {
    try {
      return { ok: true, state: this.send(event, meta), error: null };
    } catch (error) {
      return { ok: false, state: this.state, error };
    }
  }

  /** RESET then retry — used when an intercept arrives in a foreign state. */
  forceSend(event, meta = {}) {
    const first = this.trySend(event, meta);
    if (first.ok) return first;
    this.trySend(OOC_EVENTS.RESET, { reason: 'force-send-recovery', target: event });
    return this.trySend(event, meta);
  }

  reset() {
    this.trySend(OOC_EVENTS.RESET, { reason: 'explicit-reset' });
    return this.state;
  }

  onTransition(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return {
      sessionId: this.sessionId,
      state: this.state,
      allowedEvents: this.allowedEvents,
      history: this.history.map((r) => ({ ...r, meta: { ...r.meta } })),
      updatedAt: this.updatedAt,
      createdAt: this.createdAt,
    };
  }
}

/* ====================================================================== *
 * 2. Session registry
 * ====================================================================== */

export const OOC_SESSIONS = new Map();

export function getInterceptorMachine(sessionId = 'default', options = {}) {
  const key = String(sessionId ?? 'default');
  if (!OOC_SESSIONS.has(key)) OOC_SESSIONS.set(key, new OocStateMachine(key, options));
  return OOC_SESSIONS.get(key);
}

export function getInterceptorState(sessionId = 'default') {
  const machine = OOC_SESSIONS.get(String(sessionId ?? 'default'));
  return machine ? machine.snapshot() : null;
}

export function resetInterceptor(sessionId = 'default') {
  const key = String(sessionId ?? 'default');
  const machine = OOC_SESSIONS.get(key);
  if (!machine) return null;
  machine.reset();
  return machine.snapshot();
}

export function clearInterceptorSessions() {
  const count = OOC_SESSIONS.size;
  OOC_SESSIONS.clear();
  return count;
}

/* ====================================================================== *
 * 3. OOC intent classification
 * ====================================================================== */

/** Raw additive threshold; signals below this are treated as in-fiction. */
export const OOC_RAW_THRESHOLD = 2.6;
/** Divisor used to express the raw score as a 0..1 confidence. */
export const OOC_SCORE_CEILING = 7.5;

const POSITIVE_SIGNALS = Object.freeze([
  {
    id: 'ooc-marker',
    weight: 3.2,
    note: 'explicit out-of-character marker',
    re: /(?:^|[^a-z])(?:ooc|o\.o\.c\.?|out[-\s]?of[-\s]?character|meta[-\s]?(?:talk|question|query|note)|break(?:ing)? character|fourth wall)(?![a-z])/i,
  },
  {
    id: 'failure-report',
    weight: 2.6,
    note: 'reported behavioural failure',
    re: /\b(?:ignor(?:e|es|ed|ing)|isn'?t following|not following|doesn'?t follow|broke[n]?|broken|off[-\s]?character|loop(?:ing|ed|s)?|repeat(?:ing|s|ed)?|stuck|stalling|derail(?:ed|ing)?|degrad(?:e|ed|ing)|drift(?:ed|ing)?|glitch(?:ed|ing)?|regress(?:ed|ing)?|went wrong)\b/i,
  },
  {
    id: 'config-param',
    weight: 2.4,
    note: 'sampler or context-parameter reference',
    re: /\b(?:temperature|top[_\s-]?p|top[_\s-]?k|min[_\s-]?p|typical[_\s-]?p|tfs[_\s-]?z|repetition[_\s-]?penalty|frequency[_\s-]?penalty|presence[_\s-]?penalty|max[_\s-]?(?:tokens|completion[_\s-]?tokens|output[_\s-]?tokens)|num[_\s-]?predict|context[_\s-]?window|token budget|sampler|stop sequence)\b/i,
  },
  {
    id: 'prompt-surface',
    weight: 2.2,
    note: 'prompt or card-surface reference',
    re: /\b(?:system prompt|user prompt|character card|\bcard\b|persona|guidelines?|dialogue rules?|instruction set|template|context block|jailbreak|card field)\b/i,
  },
  {
    id: 'diagnostic-verb',
    weight: 2.0,
    note: 'diagnostic verb or root-cause question',
    re: /\b(?:diagnos(?:e|is|tic)|debug|audit|lint|analyz(?:e|is)|inspect|investigate|review|verify|validate|explain|why (?:are|is|did|does|do|won'?t)|what(?:'s| is) wrong|figure out|root cause|trace)\b/i,
  },
  {
    id: 'gag-trap',
    weight: 1.8,
    note: 'gag / catchphrase trap language',
    re: /\b(?:gag|catchphrase|running joke|verbal tic|mantra|tagline|keeps saying|same (?:line|phrase|joke)|broken record)\b/i,
  },
  {
    id: 'model-self-reference',
    weight: 1.7,
    note: 'model self-reference leaked into the scene',
    re: /\b(?:as an ai|language model|i (?:cannot|can'?t|am not able to)|my (?:instructions|guidelines|training|context))\b/i,
  },
  {
    id: 'negation-fatigue',
    weight: 1.5,
    note: 'negative-constraint language',
    re: /\b(?:negative constraint|constraint fatigue|too many (?:don'?ts|rules|negatives)|don'?t list|prohibition)\b/i,
  },
  {
    id: 'debug-imperative',
    weight: 1.4,
    note: 'imperative request aimed at the system',
    re: /^(?:please\s+)?(?:check|show|tell|list|explain|summari[sz]e|compare|audit|lint|report|dump|print|give me|walk me through)\b/i,
  },
  {
    id: 'structured-block',
    weight: 1.2,
    note: 'structured block or macro present',
    re: /(?:```|<\/?[a-z][\w:-]*\s*\/?>|\{\{)/i,
  },
  {
    id: 'interrogative',
    weight: 1.0,
    note: 'interrogative framing',
    re: /(?:\?|\b(?:what|why|how|when|where|who|which|can you|could you|would you|are you|is there|does)\b)/i,
  },
]);

const NEGATIVE_SIGNALS = Object.freeze([
  {
    id: 'pure-continuation',
    weight: -3.4,
    note: 'plain scene-continuation command',
    re: /^(?:continue|go on|keep going|carry on|next|more|and then|please continue)[\s.!…]*$/i,
  },
  {
    id: 'bare-affirmation',
    weight: -2.0,
    note: 'bare affirmation or acknowledgement',
    re: /^(?:ok(?:ay)?|yes|yeah|yep|no|nope|sure|thanks|thank you|got it|nice|cool|hmm+)[\s.!]*$/i,
  },
  {
    id: 'in-fiction-action',
    weight: -1.8,
    note: 'in-fiction action or dialogue only',
    re: /^(?:\*[^*]{2,}\*|"[^"]{2,}"|'[^']{2,}')[\s.!]*$/,
  },
]);

/**
 * Classify a user turn as an out-of-character diagnostic query or as
 * ordinary in-fiction input.
 *
 * @param {string} query
 * @returns {{ isDiagnostic: boolean, score: number, reasons: string[] }}
 */
export function classifyOocIntent(query) {
  const text = typeof query === 'string' ? query.trim() : '';

  if (!text) {
    return { isDiagnostic: false, score: 0, reasons: ['no-signal: empty query'] };
  }

  const reasons = [];
  let raw = 0;
  const fired = new Set();

  for (const signal of POSITIVE_SIGNALS) {
    if (fired.has(signal.id)) continue;
    let matched = false;
    try {
      matched = signal.re.test(text);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    fired.add(signal.id);
    raw += signal.weight;
    reasons.push(`${signal.id} +${signal.weight.toFixed(1)} · ${signal.note}`);
  }

  for (const signal of NEGATIVE_SIGNALS) {
    if (fired.has(signal.id)) continue;
    let matched = false;
    try {
      matched = signal.re.test(text);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    fired.add(signal.id);
    raw += signal.weight;
    reasons.push(`${signal.id} ${signal.weight.toFixed(1)} · ${signal.note}`);
  }

  const isDiagnostic = raw >= OOC_RAW_THRESHOLD;
  const score = Math.round(Math.min(1, Math.max(0, raw / OOC_SCORE_CEILING)) * 1000) / 1000;

  reasons.push(
    isDiagnostic
      ? `verdict: diagnostic (raw ${raw.toFixed(1)} ≥ ${OOC_RAW_THRESHOLD})`
      : `verdict: in-fiction (raw ${raw.toFixed(1)} < ${OOC_RAW_THRESHOLD})`,
  );

  return { isDiagnostic, score, reasons };
}

/* ====================================================================== *
 * 4. Report assembly
 * ====================================================================== */

const REMEDY_BY_RULE = Object.freeze({
  'OOC Gag Trap':
    'Dissolve the mandated catchphrase: keep the trait, drop the compulsion. Rewrite "always says X" as a situational beat the model can vary.',
  'Negative Constraint Fatigue':
    'Reframe stacked negations as positive directives (POSITIVE-REFRAME). Adherence collapses past ~4 "do not" clauses in a single field.',
  'User Agency Override':
    'Remove instructions that speak, act, or decide for the user. Redirect to world and NPC description only.',
  'Placeholder Text': 'Strip placeholder tokens before shipping the card.',
  'Unresolved Macro': 'Resolve or whitelist unknown {{macros}} for the active target.',
  'Sampler Leakage':
    'Sampler parameters inside the card body are ignored or echoed verbatim; move them to the runtime config.',
  'Unbalanced XML Block': 'Close or delete the unmatched tag so sectioning survives the round trip.',
  'Field Token Bloat': 'Trim the field or split it into discrete sections; long single fields dilute attention.',
  'Empty Field': 'Drop empty fields — they consume tokens and produce no steer.',
  'Duplicate Field Content': 'Deduplicate: repeated text competes with itself for attention weight.',
  'Hedged Directive': 'Replace hedges ("try to", "maybe") with imperative directives.',
});

const DEFAULT_REMEDY = 'Run the SB-PICOR doctor template for a full field-by-field remediation list.';

function aggregateHotspots(findings = [], limit = 6) {
  const buckets = new Map();
  for (const finding of findings) {
    if (!finding || typeof finding !== 'object') continue;
    const key = `${finding.ruleLabel ?? 'unknown'}::${finding.field ?? 'root'}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        ruleLabel: finding.ruleLabel ?? 'unknown',
        field: finding.field ?? 'root',
        line: Number.isFinite(finding.line) ? finding.line : 1,
        fixToken: finding.fixToken ?? null,
        count: 0,
        snippet: finding.snippet ?? '',
      });
    }
    const bucket = buckets.get(key);
    bucket.count += 1;
    if (Number.isFinite(finding.line) && finding.line < bucket.line) {
      bucket.line = finding.line;
      bucket.snippet = finding.snippet ?? bucket.snippet;
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count || a.line - b.line || a.ruleLabel.localeCompare(b.ruleLabel))
    .slice(0, limit);
}

function deriveRemedies(hotspots = []) {
  const out = [];
  const seen = new Set();
  for (const spot of hotspots) {
    if (seen.has(spot.ruleLabel)) continue;
    seen.add(spot.ruleLabel);
    out.push({
      ruleLabel: spot.ruleLabel,
      field: spot.field,
      line: spot.line,
      fixToken: spot.fixToken,
      remedy: REMEDY_BY_RULE[spot.ruleLabel] ?? DEFAULT_REMEDY,
    });
  }
  if (!out.length) out.push({ ruleLabel: 'general', field: null, line: null, fixToken: null, remedy: DEFAULT_REMEDY });
  return out;
}

function maybeAudit(context = {}) {
  if (context.auditResult && typeof context.auditResult === 'object') return context.auditResult;
  const candidate =
    typeof context.cardSource === 'string'
      ? context.cardSource
      : typeof context.card === 'string'
        ? context.card
        : context.card && typeof context.card.text === 'string'
          ? context.card.text
          : null;
  if (!candidate) return null;
  try {
    return auditCard(candidate, {
      cardName: context.cardName ?? null,
      maxFieldChars: context.maxFieldChars,
      negationThreshold: context.negationThreshold,
    });
  } catch {
    return null;
  }
}

/**
 * Build the structured diagnostic payload handed to the doctor template.
 */
export function buildDiagnosticReport(params = {}) {
  const {
    context = {},
    classification = { isDiagnostic: false, score: 0, reasons: [] },
    sessionId = 'default',
    query = '',
    abort = null,
    machine = null,
    warnings = [],
  } = params;

  const audit = maybeAudit(context);
  const findings = Array.isArray(audit?.findings) ? audit.findings : [];
  const hotspots = aggregateHotspots(findings);
  const remedies = deriveRemedies(hotspots);

  const report = {
    kind: 'sb-picor-diagnostic',
    version: INTERCEPTOR_VERSION,
    sessionId,
    generatedAt: new Date().toISOString(),
    status: machine && machine.state === OOC_STATES.HALTED ? 'halted' : 'ok',
    ooc: {
      query: typeof query === 'string' ? query.slice(0, 1000) : '',
      score: classification.score,
      isDiagnostic: classification.isDiagnostic,
      reasons: [...(classification.reasons ?? [])],
    },
    abort: abort ?? { requested: true, acknowledged: false, skipped: true },
    machine: machine ? { state: machine.state, history: machine.snapshot().history.slice(-12) } : null,
    card: {
      name: context.cardName ?? audit?.card?.name ?? null,
      fieldCount: audit?.card?.fieldCount ?? null,
      hash: audit?.source?.hash ?? null,
      audited: Boolean(audit),
    },
    target: {
      id: context.target ?? context.targetId ?? null,
      model: context.model ?? null,
    },
    findings,
    hotspots,
    remedies,
    stats: audit?.stats ?? null,
    warnings: [...warnings],
  };

  report.reply = formatDiagnosticReply(report);
  return report;
}

/* ====================================================================== *
 * 5. Reply rendering
 * ====================================================================== */

export function formatDiagnosticReply(report) {
  if (!report || typeof report !== 'object') return '';
  const lines = [];
  const confidence = Number.isFinite(report.ooc?.score) ? report.ooc.score.toFixed(2) : '0.00';

  lines.push(`[SB-PICOR · OOC] Scene paused — out-of-character query detected (confidence ${confidence}).`);

  if (report.hotspots?.length) {
    lines.push('', 'Diagnosis');
    for (const spot of report.hotspots.slice(0, 4)) {
      const repeat = spot.count > 1 ? ` ×${spot.count}` : '';
      lines.push(`• ${spot.ruleLabel} — \`${spot.field}\` (line ${spot.line})${repeat}`);
    }
  } else if (report.card?.audited) {
    lines.push('', 'Diagnosis', '• Card audit found no blocking defects; the drift is likely sampling-side.');
  } else {
    lines.push('', 'Diagnosis', '• No card source was attached to this session, so only the OOC query was classified.');
  }

  if (report.remedies?.length) {
    lines.push('', 'Remedies');
    for (const item of report.remedies.slice(0, 3)) lines.push(`• ${item.remedy}`);
  }

  lines.push('', 'Answer the OOC question in plain prose, then reply "resume" to return to the scene.');
  return lines.join('\n');
}

/* ====================================================================== *
 * 6. Host adapter plumbing
 * ====================================================================== */

function extractQueryText(message) {
  if (typeof message === 'string') return message;
  if (!message || typeof message !== 'object') return '';
  if (typeof message.text === 'string') return message.text;
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function callHost(host, method, ...args) {
  if (!host || typeof host[method] !== 'function') {
    return Promise.resolve({ ok: false, skipped: true, value: undefined, error: null });
  }
  try {
    const value = host[method](...args);
    if (value && typeof value.then === 'function') {
      return value
        .then((resolved) => ({ ok: true, skipped: false, value: resolved, error: null }))
        .catch((error) => ({ ok: false, skipped: false, value: undefined, error }));
    }
    return Promise.resolve({ ok: true, skipped: false, value, error: null });
  } catch (error) {
    return Promise.resolve({ ok: false, skipped: false, value: undefined, error });
  }
}

function summariseAbort(result) {
  if (result.skipped) return { aborted: false, fatal: false };
  if (!result.ok) return { aborted: false, fatal: false };
  const value = result.value;
  if (value && typeof value === 'object') {
    return { aborted: value.aborted !== false, fatal: value.fatal === true };
  }
  if (typeof value === 'boolean') return { aborted: value, fatal: false };
  return { aborted: true, fatal: false };
}

/* ====================================================================== *
 * 7. Intercept handler
 * ====================================================================== */

/**
 * Handle an inbound user turn, aborting character generation when the
 * turn is classified as an out-of-character diagnostic query.
 *
 * @param {string|object} message  Raw user message.
 * @param {object} context         Session context (card, target, ids…).
 * @param {object} host            Side-effect adapter (all hooks optional).
 * @returns {Promise<object>}      Intercept result envelope.
 */
export async function handleOocIntercept(message, context = {}, host = {}) {
  const query = extractQueryText(message);
  const classification = classifyOocIntent(query);
  const sessionId = String(context.sessionId ?? host.sessionId ?? 'default');
  const machine = getInterceptorMachine(sessionId, context.machineOptions ?? {});
  const warnings = [];

  await callHost(host, 'log', 'debug', 'ooc-intercept:classified', {
    sessionId,
    score: classification.score,
    isDiagnostic: classification.isDiagnostic,
    state: machine.state,
  });

  /* ---- Fast path: ordinary in-fiction turn ------------------------- */
  if (!classification.isDiagnostic) {
    machine.trySend(OOC_EVENTS.USER_TURN, { score: classification.score });
    return {
      intercepted: false,
      isDiagnostic: false,
      score: classification.score,
      reasons: [...classification.reasons],
      sessionId,
      state: machine.state,
      abort: { requested: false, acknowledged: false, skipped: true },
      report: null,
      reply: null,
      passthrough: true,
      error: null,
      warnings,
    };
  }

  /* ---- OOC_DETECTED ------------------------------------------------ */
  const entry = machine.forceSend(OOC_EVENTS.OOC_INTERCEPT, {
    query: query.slice(0, 240),
    score: classification.score,
  });
  if (!entry.ok) {
    warnings.push(`state machine refused OOC_INTERCEPT from ${entry.state}`);
  }

  /* ---- ABORTING ---------------------------------------------------- */
  machine.trySend(OOC_EVENTS.ABORT_REQUESTED, { reason: 'ooc-diagnostic' });

  const abortPayload = {
    sessionId,
    reason: 'ooc-intercept',
    query: query.slice(0, 500),
    score: classification.score,
    urgent: true,
  };

  const abortCall = await callHost(host, 'abortGeneration', abortPayload);
  const abortSummary = summariseAbort(abortCall);
  let halted = false;

  if (abortCall.error) {
    warnings.push(`abortGeneration threw: ${abortCall.error?.message ?? String(abortCall.error)}`);
    await callHost(host, 'log', 'warn', 'ooc-intercept:abort-error', {
      sessionId,
      error: String(abortCall.error?.message ?? abortCall.error),
    });
  }

  if (abortSummary.fatal) {
    machine.trySend(OOC_EVENTS.ABORT_FAILED, { reason: 'host-reported-fatal' });
    halted = true;
  } else {
    machine.trySend(OOC_EVENTS.ABORT_COMPLETE, {
      acknowledged: abortSummary.aborted,
      skipped: abortCall.skipped,
      degraded: Boolean(abortCall.error),
    });
  }

  const abortRecord = {
    requested: true,
    acknowledged: abortSummary.aborted,
    skipped: abortCall.skipped,
    degraded: Boolean(abortCall.error),
    fatal: abortSummary.fatal,
    error: abortCall.error ? String(abortCall.error?.message ?? abortCall.error) : null,
  };

  /* ---- DIAGNOSING -------------------------------------------------- */
  let report = null;
  let reportError = null;

  if (!halted) machine.trySend(OOC_EVENTS.DIAGNOSTIC_READY, { source: 'inline-audit' });

  try {
    report = buildDiagnosticReport({
      context: { ...context, sessionId },
      classification,
      sessionId,
      query,
      abort: abortRecord,
      machine,
      warnings,
    });
  } catch (error) {
    reportError = error;
    warnings.push(`diagnostic build failed: ${error?.message ?? String(error)}`);
    if (!halted) {
      machine.trySend(OOC_EVENTS.DIAGNOSTIC_FAILED, { error: String(error?.message ?? error) });
      halted = true;
    }
  }

  /* ---- REPORTING --------------------------------------------------- */
  const reply = report?.reply ?? '';

  if (report) {
    await callHost(host, 'emitDiagnostic', report);
    if (reply) await callHost(host, 'emitSystemMessage', reply, { kind: 'ooc-diagnostic', sessionId });
    await callHost(host, 'saveReport', report);
    if (!halted) machine.trySend(OOC_EVENTS.REPORT_EMITTED, { hotspots: report.hotspots?.length ?? 0 });
  }

  await callHost(host, 'log', 'info', 'ooc-intercept:handled', {
    sessionId,
    state: machine.state,
    halted,
    hotspots: report?.hotspots?.length ?? 0,
  });

  return {
    intercepted: true,
    isDiagnostic: true,
    score: classification.score,
    reasons: [...classification.reasons],
    sessionId,
    state: machine.state,
    halted,
    abort: abortRecord,
    report,
    reply,
    passthrough: false,
    error: reportError ? String(reportError?.message ?? reportError) : null,
    warnings,
  };
}

/**
 * Mark the scene as resumed after an OOC interlude.
 */
export async function resumeInterceptor(sessionId = 'default', host = {}) {
  const machine = getInterceptorMachine(sessionId);
  const result = machine.trySend(OOC_EVENTS.RESUME, { reason: 'user-resume' });
  if (result.ok) await callHost(host, 'log', 'info', 'ooc-intercept:resumed', { sessionId });
  return {
    resumed: result.ok,
    sessionId,
    state: machine.state,
    error: result.error ? String(result.error?.message ?? result.error) : null,
  };
}

/**
 * Notify the interceptor that a generation cycle started/ended so the
 * state machine tracks the live stream accurately.
 */
export function notifyGeneration(sessionId, active, host = {}) {
  const machine = getInterceptorMachine(sessionId);
  const event = active ? OOC_EVENTS.GENERATION_START : OOC_EVENTS.GENERATION_END;
  const result = machine.trySend(event, { at: Date.now() });
  if (typeof host?.log === 'function') {
    try {
      host.log('debug', `ooc-intercept:${active ? 'generation-start' : 'generation-end'}`, { sessionId });
    } catch {
      /* ignore logging failures */
    }
  }
  return { ok: result.ok, state: machine.state };
}

export default {
  INTERCEPTOR_VERSION,
  OOC_STATES,
  OOC_EVENTS,
  OocStateMachine,
  OocTransitionError,
  OOC_SESSIONS,
  classifyOocIntent,
  buildDiagnosticReport,
  formatDiagnosticReply,
  handleOocIntercept,
  resumeInterceptor,
  notifyGeneration,
  getInterceptorMachine,
  getInterceptorState,
  resetInterceptor,
};
