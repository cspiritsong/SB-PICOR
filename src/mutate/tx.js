/**
 * SB-PICOR Alpha 2 — Transaction layer
 * ====================================
 * Implements:
 *   I3 — no mutation without a journal entry (pre-image snapshot + rollback)
 *   I4 — no fix executes unless the analyzer minted it (fix tokens)
 *
 * Design stance
 * -------------
 * The *operators* (`muteCardLine`, `stripSampler`, `undoLast`) are pure: they
 * take a value in and return a new value plus a journal entry out. They never
 * read a clock, never generate randomness, and never touch the host.
 *
 * `createTxEngine()` is the impure edge. It is constructed by `index.js` with
 * injected `now()` and `entropy()` providers. Nothing in this module calls
 * `Date.now()` or `Math.random()` directly.
 *
 * Crash safety
 * ------------
 * Every operator appends a `status: 'staged'` entry BEFORE the host write is
 * attempted. The executor then calls `engine.commit(entryId)` on success or
 * `engine.abort(entryId)` on failure. If the process dies in between,
 * `engine.reconcile(probe)` deterministically resolves staged entries by
 * comparing the live field hash against the recorded pre/post hashes.
 */

import {
  SBP_VERSION,
  hashText,
} from '../ast/source-indexer.js';

import {
  canonicalCardField,
  CARD_FIELDS,
  INDEX_SCHEMA as _INDEX_SCHEMA,
  estimateTokens,
  hashText as hashLineText,
  joinParts,
  omitValueAtPath,
  resolveFieldLocation,
  setValueAtPath,
  splitLines,
} from '../ast/source-indexer.js';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

export const TX_SCHEMA = 'sbp.tx.v1';
export const JOURNAL_SCHEMA = 'sbp.txjournal.v1';
export const MINT_SCHEMA = 'sbp.fixmint.v1';

export const JOURNAL_LIMIT_DEFAULT = 25;
export const TOKEN_TTL_DEFAULT = 15 * 60 * 1000; // 15 minutes
export const TOKEN_PREFIX = 'sbp1_';
export const TOKEN_DIGEST_LENGTH = 24;
export const MAX_MINTED_TOKENS_DEFAULT = 256;

export const MUTE_PREFIX = '// [Muted by SB-PICOR]: ';

/** Stable sentinel hash for "the key did not exist". */
export const ABSENT_HASH = hashLineText('\u0000SB-PICOR:ABSENT');

export const TX_OPS = Object.freeze({
  MUTE_CARD_LINE: 'muteCardLine',
  STRIP_SAMPLER: 'stripSampler',
});

/** Ops the template's `actions.allow` list declares. */
export const ALLOWED_OPS = Object.freeze([
  'muteCardLine',
  'softenCardLine',
  'stripSampler',
  'activateTailoredPreset',
  'revealLine',
  'openField',
  'compilePreset',
  'undoLast',
]);

/** Ops the template's `actions.deny` list declares. Never executable. */
export const DENIED_OPS = Object.freeze([
  'deleteCharacter',
  'clearChat',
  'writeArbitraryField',
  'eval',
]);

/** Ops implemented by this batch. Anything else is rejected loudly. */
export const IMPLEMENTED_OPS = Object.freeze([
  TX_OPS.MUTE_CARD_LINE,
  TX_OPS.STRIP_SAMPLER,
]);

/** Mirrors `actions.confirm_required` in tpl-sb-picor-doctor.json. */
export const OPS_REQUIRING_CONFIRM = Object.freeze([
  'muteCardLine',
  'stripSampler',
  'activateTailoredPreset',
]);

/** Executor whitelist for sampler parameters (`stripSampler` accepts nothing else). */
export const SAMPLER_PARAMETERS = Object.freeze([
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'max_tokens',
  'max_new_tokens',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'encoder_repetition_penalty',
  'no_repeat_ngram_size',
  'penalty_alpha',
  'typical_p',
  'tfs',
  'top_a',
  'mirostat',
  'mirostat_tau',
  'mirostat_eta',
  'seed',
  'stop',
  'stop_sequences',
  'n',
  'num_beams',
  'cfg_scale',
  'guidance_scale',
  'negative_prompt',
  'dry_multiplier',
  'dry_base',
  'dry_allowed_length',
  'dry_sequence_breakers',
  'xtc_threshold',
  'xtc_probability',
  'smoothing_factor',
  'smoothing_curve',
  'dynatemp_range',
  'dynatemp_exponent',
]);

const SAMPLER_PARAMETER_SET = new Set(SAMPLER_PARAMETERS);

/** Parameter name aliases accepted for lookup (path recorded is the real key). */
const PARAM_ALIASES = Object.freeze({
  max_tokens: Object.freeze(['openai_max_tokens']),
  max_new_tokens: Object.freeze(['openai_max_tokens']),
  seed: Object.freeze(['sampler_seed']),
  top_k: Object.freeze(['topK']),
  top_p: Object.freeze(['topP']),
});

const PARAM_CONTAINER_PATHS = Object.freeze([
  Object.freeze([]),
  Object.freeze(['parameters']),
  Object.freeze(['samplers']),
  Object.freeze(['sampler']),
]);

/** Machine-readable error codes. The UI keys off these; never change them. */
export const CODES = Object.freeze({
  OK: 'SBP-OK',

  ARG_TYPE: 'SBP-E-ARG_TYPE',
  CARD_TYPE: 'SBP-E-CARD_TYPE',
  PRESET_TYPE: 'SBP-E-PRESET_TYPE',

  FIELD_UNKNOWN: 'SBP-E-FIELD_UNKNOWN',
  FIELD_ABSENT: 'SBP-E-FIELD_ABSENT',
  FIELD_NOT_TEXT: 'SBP-E-FIELD_NOT_TEXT',
  FIELD_DRIFT: 'SBP-E-FIELD_DRIFT',

  LINE_INVALID: 'SBP-E-LINE_INVALID',
  LINE_OUT_OF_RANGE: 'SBP-E-LINE_OUT_OF_RANGE',
  LINE_BLANK: 'SBP-E-LINE_BLANK',
  LINE_ALREADY_MUTED: 'SBP-E-LINE_ALREADY_MUTED',

  ANCHOR_REQUIRED: 'SBP-E-ANCHOR_REQUIRED',
  ANCHOR_DRIFT: 'SBP-E-ANCHOR_DRIFT',

  PARAM_INVALID: 'SBP-E-PARAM_INVALID',
  PARAM_NOT_ALLOWED: 'SBP-E-PARAM_NOT_ALLOWED',
  PARAM_ABSENT: 'SBP-E-PARAM_ABSENT',

  CONFIRM_REQUIRED: 'SBP-E-CONFIRM_REQUIRED',

  OP_NOT_ALLOWED: 'SBP-E-OP_NOT_ALLOWED',
  OP_DENIED: 'SBP-E-OP_DENIED',
  OP_UNSUPPORTED: 'SBP-E-OP_UNSUPPORTED',

  FIX_ID_REQUIRED: 'SBP-E-FIX_ID_REQUIRED',
  TARGET_INVALID: 'SBP-E-TARGET_INVALID',

  TOKEN_REQUIRED: 'SBP-E-TOKEN_REQUIRED',
  TOKEN_MALFORMED: 'SBP-E-TOKEN_MALFORMED',
  TOKEN_UNKNOWN: 'SBP-E-TOKEN_UNKNOWN',
  TOKEN_CONSUMED: 'SBP-E-TOKEN_CONSUMED',
  TOKEN_EXPIRED: 'SBP-E-TOKEN_EXPIRED',
  TOKEN_SCOPE: 'SBP-E-TOKEN_SCOPE',
  TOKEN_CLOCK: 'SBP-E-TOKEN_CLOCK',

  JOURNAL_INVALID: 'SBP-E-JOURNAL_INVALID',
  NOTHING_TO_UNDO: 'SBP-E-NOTHING_TO_UNDO',
  TX_NOT_FOUND: 'SBP-E-TX_NOT_FOUND',

  CLOCK_UNAVAILABLE: 'SBP-E-CLOCK_UNAVAILABLE',
});

/* ------------------------------------------------------------------ *
 * Generic helpers
 * ------------------------------------------------------------------ */

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function ok(payload) {
  return { ok: true, code: CODES.OK, message: null, ...payload };
}

function failure(code, message, details) {
  return { ok: false, code, message, details: details ?? null };
}

function typeGuard(value, expected, code, label) {
  const valid =
    expected === 'object'
      ? isPlainObject(value)
      : expected === 'string'
        ? typeof value === 'string'
        : typeof value === expected;
  if (!valid) {
    return failure(code, `${label} must be of type ${expected}.`, {
      received: Array.isArray(value) ? 'array' : typeof value,
    });
  }
  return null;
}

/** Deterministic JSON with sorted object keys. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortValue(value[key]);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

/** Structural clone that never aliases the caller's graph. */
export function cloneValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to JSON */
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/** Hash an arbitrary JSON value (used for sampler pre-images). */
export function hashValue(value) {
  if (value === undefined) return ABSENT_HASH;
  return hashLineText(canonicalJson(value));
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

function resolveCardId(card) {
  if (!isPlainObject(card)) return null;
  const candidate = card.avatar ?? card.id ?? card.name ?? null;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function resolvePresetId(preset) {
  if (!isPlainObject(preset)) return null;
  const candidate = preset.name ?? preset.preset_name ?? preset.id ?? null;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/* ------------------------------------------------------------------ *
 * Mute marker
 * ------------------------------------------------------------------ */

export function isMuted(lineText) {
  return typeof lineText === 'string' && lineText.startsWith(MUTE_PREFIX);
}

export function muteLine(lineText) {
  return MUTE_PREFIX + lineText;
}

/* ------------------------------------------------------------------ *
 * Journal
 * ------------------------------------------------------------------ */

export function createJournal(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  return Object.freeze({
    schema: JOURNAL_SCHEMA,
    version: SBP_VERSION,
    sessionNonce: typeof input.sessionNonce === 'string' ? input.sessionNonce : null,
    limit: Number.isInteger(input.limit) ? input.limit : JOURNAL_LIMIT_DEFAULT,
    revision: Number.isInteger(input.revision) ? input.revision : 0,
    entries: Object.freeze(entries.slice()),
  });
}

/**
 * Append an entry. Oldest entries are dropped past `limit`; undo depth is
 * therefore bounded by `limit` (documented, never silent — `dropped` reports it).
 */
export function appendJournalEntry(journal, entry) {
  const base = journal && Array.isArray(journal.entries) ? journal : createJournal();
  const limit = Number.isInteger(base.limit) ? base.limit : JOURNAL_LIMIT_DEFAULT;

  let entries = [...base.entries, entry];
  let dropped = 0;
  if (entries.length > limit) {
    dropped = entries.length - limit;
    entries = entries.slice(dropped);
  }

  return Object.freeze({
    ...base,
    revision: (base.revision ?? 0) + 1,
    entries: Object.freeze(entries),
    dropped,
  });
}

export function updateJournalEntry(journal, entryId, patch) {
  if (!journal || !Array.isArray(journal.entries)) {
    return failure(CODES.JOURNAL_INVALID, 'Journal is malformed.');
  }
  const index = journal.entries.findIndex((e) => e && e.id === entryId);
  if (index === -1) {
    return failure(CODES.TX_NOT_FOUND, `No transaction with id "${entryId}".`, { entryId });
  }
  const entries = journal.entries.slice();
  entries[index] = Object.freeze({ ...entries[index], ...patch });
  return ok({
    journal: Object.freeze({
      ...journal,
      revision: (journal.revision ?? 0) + 1,
      entries: Object.freeze(entries),
    }),
    entry: entries[index],
  });
}

/** Entries that `undoLast` would consider, newest first. */
export function listUndoable(journal) {
  if (!journal || !Array.isArray(journal.entries)) return [];
  const out = [];
  for (let i = journal.entries.length - 1; i >= 0; i -= 1) {
    const entry = journal.entries[i];
    if (!entry) continue;
    if (entry.status !== 'applied') continue;
    if (entry.undone === true) continue;
    if (entry.undoable === false || entry.reversible === false) continue;
    out.push(entry);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Journal serialization (persisted in extension settings)
 * ------------------------------------------------------------------ */

export function serializeJournal(journal) {
  const base = journal && Array.isArray(journal.entries) ? journal : createJournal();
  return canonicalJson(base);
}

/** Never throws on garbage input; returns `null` instead. */
export function deserializeJournal(raw) {
  if (raw === null || raw === undefined || raw === '') return null;

  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isPlainObject(value)) return null;
  if (value.schema !== JOURNAL_SCHEMA) return null;
  if (!Array.isArray(value.entries)) return null;

  const entries = [];
  for (const entry of value.entries) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || typeof entry.op !== 'string') {
      continue;
    }
    entries.push(entry);
  }

  return createJournal({
    sessionNonce: value.sessionNonce,
    limit: value.limit,
    revision: value.revision,
    entries,
  });
}

/* ------------------------------------------------------------------ *
 * Fix tokens (Invariant I4)
 * ------------------------------------------------------------------ */

export function buildScope(op, target) {
  const parts = [op, target.kind, target.id ?? '-'];
  if (target.field != null) parts.push(target.field);
  if (target.line != null) parts.push(String(target.line));
  if (target.parameter != null) parts.push(target.parameter);
  return parts.join(':');
}

function normalizeTarget(target) {
  if (!isPlainObject(target)) return null;
  const kind = target.kind;
  if (kind !== 'card' && kind !== 'preset') return null;
  return Object.freeze({
    kind,
    id: typeof target.id === 'string' && target.id.length > 0 ? target.id : null,
    field: typeof target.field === 'string' ? target.field : null,
    line: Number.isInteger(target.line) ? target.line : null,
    parameter: typeof target.parameter === 'string' ? target.parameter : null,
  });
}

function fixDigest({ sessionNonce, fixId, op, scope, seq, issuedAt }) {
  return hashLineText(
    [sessionNonce, fixId, op, scope, String(seq), String(issuedAt)].join('|'),
  ).slice(0, TOKEN_DIGEST_LENGTH);
}

export function createMintRegistry(input = {}) {
  const sessionNonce = input.sessionNonce;
  if (typeof sessionNonce !== 'string' || sessionNonce.length < 8) {
    throw new TypeError('createMintRegistry: sessionNonce must be a string of >= 8 chars');
  }
  return Object.freeze({
    schema: MINT_SCHEMA,
    version: SBP_VERSION,
    sessionNonce,
    ttlMs: Number.isInteger(input.ttlMs) ? input.ttlMs : TOKEN_TTL_DEFAULT,
    maxTokens: Number.isInteger(input.maxTokens) ? input.maxTokens : MAX_MINTED_TOKENS_DEFAULT,
    counter: Number.isInteger(input.counter) ? input.counter : 0,
    issued: Object.freeze(isPlainObject(input.issued) ? { ...input.issued } : {}),
  });
}

/**
 * Mint a fix token. `request.fixId` MUST come from an analyzer finding —
 * the LLM may only *name* a fix, never author one.
 */
export function mintFixToken(registry, request, options = {}) {
  if (!registry || registry.schema !== MINT_SCHEMA) {
    return failure(CODES.JOURNAL_INVALID, 'Mint registry is malformed.');
  }
  const now = Number.isFinite(options.now) ? options.now : null;
  if (now === null) {
    return failure(
      CODES.TOKEN_CLOCK,
      'mintFixToken requires options.now (pure core holds no clock).',
    );
  }

  const op = request?.op;
  if (typeof op !== 'string' || op.length === 0) {
    return failure(CODES.OP_NOT_ALLOWED, 'request.op is required.', { op: op ?? null });
  }
  if (DENIED_OPS.includes(op)) {
    return failure(CODES.OP_DENIED, `"${op}" is on the executor denylist.`, { op });
  }
  if (!ALLOWED_OPS.includes(op)) {
    return failure(CODES.OP_NOT_ALLOWED, `"${op}" is not on the executor allowlist.`, { op });
  }

  const fixId = request?.fixId;
  if (typeof fixId !== 'string' || fixId.length === 0) {
    return failure(
      CODES.FIX_ID_REQUIRED,
      'request.fixId must identify an analyzer finding (Invariant I4).',
    );
  }

  const target = normalizeTarget(request?.target);
  if (!target) {
    return failure(CODES.TARGET_INVALID, 'request.target must be a card/preset target.', {
      target: request?.target ?? null,
    });
  }

  const seq = registry.counter + 1;
  const scope = buildScope(op, target);
  const issuedAt = now;
  const expiresAt = now + registry.ttlMs;
  const digest = fixDigest({
    sessionNonce: registry.sessionNonce,
    fixId,
    op,
    scope,
    seq,
    issuedAt,
  });
  const token = `${TOKEN_PREFIX}${digest}`;

  const record = Object.freeze({
    id: `fix_${digest.slice(0, 12)}`,
    token,
    fixId,
    op,
    scope,
    target,
    seq,
    issuedAt,
    expiresAt,
    consumedAt: null,
    reason: typeof request?.reason === 'string' ? request.reason : null,
  });

  let next = Object.freeze({
    ...registry,
    counter: seq,
    issued: Object.freeze({ ...registry.issued, [token]: record }),
  });
  next = pruneFixTokens(next, now);

  return ok({ token, record, registry: next });
}

export function verifyFixToken(registry, token, claim = {}, options = {}) {
  if (!registry || registry.schema !== MINT_SCHEMA) {
    return failure(CODES.JOURNAL_INVALID, 'Mint registry is malformed.');
  }
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) {
    return failure(CODES.TOKEN_MALFORMED, 'Fix token is malformed.', {
      token: typeof token === 'string' ? token.slice(0, 12) : null,
    });
  }

  const record = registry.issued[token];
  if (!record) {
    return failure(CODES.TOKEN_UNKNOWN, 'Fix token was not minted in this session.', {
      token,
    });
  }

  const now = Number.isFinite(options.now) ? options.now : null;
  if (now !== null && now > record.expiresAt) {
    return failure(CODES.TOKEN_EXPIRED, 'Fix token has expired; re-run the scan.', {
      expiredAt: record.expiresAt,
      now,
    });
  }

  // Recompute from the recorded facts: guards against a tampered record store.
  const expectedDigest = fixDigest({
    sessionNonce: registry.sessionNonce,
    fixId: record.fixId,
    op: record.op,
    scope: record.scope,
    seq: record.seq,
    issuedAt: record.issuedAt,
  });
  if (token !== `${TOKEN_PREFIX}${expectedDigest}`) {
    return failure(CODES.TOKEN_MALFORMED, 'Fix token failed digest verification.', { token });
  }

  if (record.consumedAt !== null) {
    return failure(CODES.TOKEN_CONSUMED, 'Fix token has already been used.', {
      token,
      consumedAt: record.consumedAt,
    });
  }

  if (typeof claim.op === 'string' && claim.op !== record.op) {
    return failure(CODES.TOKEN_SCOPE, 'Fix token op does not match the requested op.', {
      tokenOp: record.op,
      claimOp: claim.op,
    });
  }

  if (claim.target) {
    const claimTarget = normalizeTarget(claim.target);
    if (!claimTarget) {
      return failure(CODES.TARGET_INVALID, 'claim.target is malformed.');
    }
    const claimScope = buildScope(record.op, claimTarget);
    if (claimScope !== record.scope) {
      return failure(CODES.TOKEN_SCOPE, 'Fix token is scoped to a different target.', {
        tokenScope: record.scope,
        claimScope,
      });
    }
  }

  return ok({ record, scope: record.scope });
}

export function consumeFixToken(registry, token, options = {}) {
  const verification = verifyFixToken(registry, token, options.claim ?? {}, options);
  if (!verification.ok) return verification;

  const now = Number.isFinite(options.now) ? options.now : null;
  const issued = {
    ...registry.issued,
    [token]: Object.freeze({ ...verification.record, consumedAt: now }),
  };
  return ok({
    record: issued[token],
    registry: Object.freeze({ ...registry, issued: Object.freeze(issued) }),
  });
}

/** Drop expired / long-consumed tokens and enforce the size ceiling. */
export function pruneFixTokens(registry, now) {
  const horizon = (Number.isFinite(now) ? now : 0) - registry.ttlMs * 2;
  const kept = [];

  for (const record of Object.values(registry.issued)) {
    const stale =
      (Number.isFinite(now) && now > record.expiresAt && record.consumedAt === null) ||
      (record.consumedAt !== null && record.consumedAt < horizon);
    if (!stale) kept.push(record);
  }

  kept.sort((a, b) => a.seq - b.seq);
  const overflow = kept.length - registry.maxTokens;
  const finalRecords = overflow > 0 ? kept.slice(overflow) : kept;

  const issued = {};
  for (const record of finalRecords) issued[record.token] = record;

  return Object.freeze({ ...registry, issued: Object.freeze(issued) });
}

/* ------------------------------------------------------------------ *
 * Journal entry construction
 * ------------------------------------------------------------------ */

function normalizeFixTokenRecord(fixToken) {
  if (!isPlainObject(fixToken)) return null;
  return Object.freeze({
    id: typeof fixToken.id === 'string' ? fixToken.id : null,
    token: typeof fixToken.token === 'string' ? fixToken.token : null,
    fixId: typeof fixToken.fixId === 'string' ? fixToken.fixId : null,
    op: typeof fixToken.op === 'string' ? fixToken.op : null,
    scope: typeof fixToken.scope === 'string' ? fixToken.scope : null,
  });
}

function buildEntry({ op, target, anchor, pre, post, delta, meta }) {
  const payload = canonicalJson({
    op,
    target,
    preHash: pre.hash,
    postHash: post.hash,
    seq: Number.isInteger(meta.seq) ? meta.seq : null,
  });
  const id =
    typeof meta.txId === 'string' && meta.txId.length > 0
      ? meta.txId
      : `tx_${hashLineText(`${meta.sessionNonce ?? 'no-session'}|${payload}`).slice(0, 12)}`;

  return Object.freeze({
    schema: TX_SCHEMA,
    id,
    seq: Number.isInteger(meta.seq) ? meta.seq : null,
    ts: Number.isFinite(meta.now) ? meta.now : null,
    op,
    status: 'staged',
    appVersion: SBP_VERSION,
    sessionNonce: typeof meta.sessionNonce === 'string' ? meta.sessionNonce : null,
    fixToken: normalizeFixTokenRecord(meta.fixToken),
    reason: typeof meta.reason === 'string' ? meta.reason : null,
    target: Object.freeze(target),
    anchor: anchor ? Object.freeze(anchor) : null,
    pre: deepFreeze({ value: pre.value, hash: pre.hash, path: pre.path ?? null }),
    post: deepFreeze({ value: post.value, hash: post.hash, path: post.path ?? null }),
    delta: Object.freeze(delta),
    reversible: true,
    undoable: true,
    undone: false,
    undoneAt: null,
    appliedAt: null,
    failedAt: null,
    failureReason: null,
  });
}

/* ------------------------------------------------------------------ *
 * Confirmation gate (mirrors template `actions.confirm_required`)
 * ------------------------------------------------------------------ */

export function assertConfirmation(op, options = {}) {
  if (!OPS_REQUIRING_CONFIRM.includes(op)) return null;
  if (options.confirmed === true) return null;
  if (options.trustedQuickFix === true) return null; // sb_picor.trustedQuickFix
  return failure(
    CODES.CONFIRM_REQUIRED,
    `"${op}" requires explicit confirmation (actions.confirm_required).`,
    { op, setting: 'sb_picor.trustedQuickFix' },
  );
}

/* ------------------------------------------------------------------ *
 * Operator: muteCardLine
 * ------------------------------------------------------------------ */

/**
 * Comment out one card line.
 *
 * @param {object} card                live card object (never mutated)
 * @param {string} field               canonical or aliased field name
 * @param {number} lineNumber          1-indexed
 * @param {string} expectedHash        hash from `resolveAnchor` — REQUIRED (I2)
 * @param {object} [meta]              { now, txId, seq, sessionNonce, fixToken, reason }
 * @returns {{ok: boolean, code: string, card?: object, entry?: object, ...}}
 */
export function muteCardLine(card, field, lineNumber, expectedHash, meta = {}) {
  const cardGuard = typeGuard(card, 'object', CODES.CARD_TYPE, 'card');
  if (cardGuard) return cardGuard;

  const loc = resolveFieldLocation(card, field);
  if (!loc) {
    return failure(CODES.FIELD_UNKNOWN, `Field "${String(field)}" is not an indexed card field.`, {
      field: typeof field === 'string' ? field : null,
    });
  }
  if (!loc.found) {
    return failure(CODES.FIELD_ABSENT, `Field "${loc.field}" is not present on this card.`, {
      field: loc.field,
    });
  }
  if (!loc.isText) {
    return failure(CODES.FIELD_NOT_TEXT, `Field "${loc.field}" is not a string.`, {
      field: loc.field,
      received: typeof loc.value,
    });
  }

  if (typeof expectedHash !== 'string' || expectedHash.length === 0) {
    return failure(
      CODES.ANCHOR_REQUIRED,
      'expectedHash is required: no mutation without a verifying anchor (Invariant I2).',
      { field: loc.field, line: lineNumber },
    );
  }
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    return failure(CODES.LINE_INVALID, 'lineNumber must be a positive integer.', { lineNumber });
  }

  const original = loc.value;
  const parts = splitLines(original);

  if (lineNumber > parts.length) {
    return failure(
      CODES.LINE_OUT_OF_RANGE,
      `Line ${lineNumber} is out of range (field has ${parts.length} lines).`,
      { field: loc.field, line: lineNumber, fieldLineCount: parts.length },
    );
  }

  const part = parts[lineNumber - 1];

  if (isMuted(part.text)) {
    return failure(CODES.LINE_ALREADY_MUTED, `Line ${lineNumber} is already muted.`, {
      field: loc.field,
      line: lineNumber,
    });
  }
  if (part.text.trim().length === 0) {
    return failure(
      CODES.LINE_BLANK,
      `Line ${lineNumber} is blank; muting it is a no-op and anchors to it are ambiguous.`,
      { field: loc.field, line: lineNumber },
    );
  }

  // Last line of defence against TOCTOU between resolveAnchor() and here (I2).
  const observedHash = hashLineText(part.text);
  if (observedHash !== expectedHash) {
    return failure(
      CODES.ANCHOR_DRIFT,
      `Anchor drift on ${loc.field}:${lineNumber} — observed ${observedHash}, expected ${expectedHash}. Write refused.`,
      {
        field: loc.field,
        line: lineNumber,
        expected: expectedHash,
        observed: observedHash,
        preview: part.text.slice(0, 120),
      },
    );
  }

  const mutedText = muteLine(part.text);
  const nextParts = parts.slice();
  nextParts[lineNumber - 1] = { text: mutedText, eol: part.eol };
  const nextValue = joinParts(nextParts);

  // Structural self-check (Invariant I8). A failure here is a code bug, not
  // user input, so we throw rather than return a soft error.
  if (joinParts(splitLines(nextValue)) !== nextValue) {
    throw new Error('SB-PICOR I8 violation inside muteCardLine — refusing to emit a value');
  }

  const nextCard = setValueAtPath(card, loc.path, nextValue);
  const nextHash = hashLineText(mutedText);

  const entry = buildEntry({
    op: TX_OPS.MUTE_CARD_LINE,
    target: {
      kind: 'card',
      id: resolveCardId(card),
      field: loc.field,
      key: loc.key,
      path: loc.path,
      line: lineNumber,
      canonical: CARD_FIELDS.includes(loc.field),
    },
    anchor: {
      source: 'card',
      field: loc.field,
      line: lineNumber,
      hash: expectedHash,
    },
    pre: { value: original, hash: hashLineText(original), path: loc.path },
    post: { value: nextValue, hash: hashLineText(nextValue), path: loc.path },
    delta: {
      chars: nextValue.length - original.length,
      lines: 0,
      lineHashBefore: observedHash,
      lineHashAfter: nextHash,
    },
    meta,
  });

  return ok({
    card: nextCard,
    entry,
    field: loc.field,
    path: loc.path,
    nextLine: {
      line: lineNumber,
      text: mutedText,
      hash: nextHash,
      tokenEstimate: estimateTokens(mutedText),
    },
  });
}

/* ------------------------------------------------------------------ *
 * Operator: stripSampler
 * ------------------------------------------------------------------ */

function normalizeParameterName(raw) {
  if (typeof raw !== 'string') return null;
  let name = raw.trim();
  if (name.length === 0) return null;
  name = name.replace(/^(?:parameters|samplers|sampler)\./i, '');
  return name.toLowerCase();
}

function locateSamplerParameter(preset, name) {
  const wanted = [name, ...(PARAM_ALIASES[name] ?? [])].map((n) => n.toLowerCase());

  for (const containerPath of PARAM_CONTAINER_PATHS) {
    const container = containerPath.length === 0 ? preset : preset[containerPath[0]];
    if (!isPlainObject(container)) continue;
    for (const key of Object.keys(container)) {
      if (!wanted.includes(key.toLowerCase())) continue;
      return {
        found: true,
        key,
        path: [...containerPath, key],
        container,
        value: container[key],
      };
    }
  }
  return { found: false, key: null, path: null, container: null, value: undefined };
}

/**
 * Remove a sampler parameter so the provider default applies.
 *
 * @param {object} preset
 * @param {string} parameterName  must be on the executor whitelist
 * @param {object} [meta]         { now, txId, seq, sessionNonce, fixToken, reason }
 */
export function stripSampler(preset, parameterName, meta = {}) {
  const presetGuard = typeGuard(preset, 'object', CODES.PRESET_TYPE, 'preset');
  if (presetGuard) return presetGuard;

  const name = normalizeParameterName(parameterName);
  if (!name) {
    return failure(CODES.PARAM_INVALID, 'parameterName must be a non-empty string.', {
      parameterName: parameterName ?? null,
    });
  }
  if (!SAMPLER_PARAMETER_SET.has(name)) {
    return failure(
      CODES.PARAM_NOT_ALLOWED,
      `"${name}" is not on the SB-PICOR sampler whitelist (executor allowlist, Invariant I4).`,
      { parameter: name, whitelistSize: SAMPLER_PARAMETERS.length },
    );
  }

  const loc = locateSamplerParameter(preset, name);
  if (!loc.found) {
    return failure(CODES.PARAM_ABSENT, `Parameter "${name}" is not set on this preset.`, {
      parameter: name,
    });
  }

  const preValue = cloneValue(loc.value);
  const nextPreset = omitValueAtPath(preset, loc.path);

  const entry = buildEntry({
    op: TX_OPS.STRIP_SAMPLER,
    target: {
      kind: 'preset',
      id: resolvePresetId(preset),
      parameter: name,
      key: loc.key,
      path: loc.path,
    },
    anchor: {
      source: 'preset',
      field: loc.path.join('.'),
      line: 1,
      hash: hashValue(preValue),
    },
    pre: { value: preValue, hash: hashValue(preValue), path: loc.path },
    post: { value: undefined, hash: ABSENT_HASH, path: loc.path },
    delta: { chars: 0, lines: 0, removedKey: loc.key },
    meta,
  });

  return ok({
    preset: nextPreset,
    entry,
    parameter: name,
    path: loc.path,
    previousValue: preValue,
  });
}

/* ------------------------------------------------------------------ *
 * Operator: undoLast
 * ------------------------------------------------------------------ */

/**
 * Produce the inverse patch for the newest applied transaction.
 *
 * The returned journal is a PROPOSAL: apply `patch` through the host adapter
 * first, and only persist `journal` if the host write succeeded. If the write
 * fails, discard the returned journal — the on-disk journal still describes
 * reality.
 *
 * @param {object} journal
 * @param {{now?: number, expectedFixTokenId?: string}} [options]
 */
export function undoLast(journal, options = {}) {
  const base = journal && Array.isArray(journal.entries) ? journal : deserializeJournal(journal);
  if (!base) {
    return failure(CODES.JOURNAL_INVALID, 'Journal is malformed or unreadable.');
  }

  let index = -1;
  for (let i = base.entries.length - 1; i >= 0; i -= 1) {
    const entry = base.entries[i];
    if (!entry) continue;
    if (entry.status !== 'applied') continue;
    if (entry.undone === true) continue;
    if (entry.undoable === false || entry.reversible === false) continue;
    index = i;
    break;
  }

  if (index === -1) {
    return failure(CODES.NOTHING_TO_UNDO, 'No applied, reversible transaction in the journal.');
  }

  const entry = base.entries[index];

  if (
    typeof options.expectedFixTokenId === 'string' &&
    entry.fixToken?.id !== options.expectedFixTokenId
  ) {
    return failure(CODES.TOKEN_SCOPE, 'Newest transaction was not produced by that fix token.', {
      expected: options.expectedFixTokenId,
      actual: entry.fixToken?.id ?? null,
    });
  }

  let patch;
  if (entry.op === TX_OPS.MUTE_CARD_LINE) {
    patch = {
      kind: 'card-field-restore',
      source: 'card',
      targetId: entry.target.id,
      field: entry.target.field,
      key: entry.target.key,
      path: entry.pre.path,
      value: entry.pre.value, // string — immutable, safe to hand out
      expectFieldHash: entry.post.hash, // executor MUST verify before writing
      resultFieldHash: entry.pre.hash,
    };
  } else if (entry.op === TX_OPS.STRIP_SAMPLER) {
    patch = {
      kind: 'preset-param-restore',
      source: 'preset',
      targetId: entry.target.id,
      parameter: entry.target.parameter,
      path: entry.pre.path,
      value: cloneValue(entry.pre.value), // never hand out a frozen reference
      expectFieldHash: ABSENT_HASH,
      resultFieldHash: entry.pre.hash,
    };
  } else {
    return failure(CODES.OP_UNSUPPORTED, `Cannot undo op "${entry.op}".`, { op: entry.op });
  }

  const undoneAt = Number.isFinite(options.now) ? options.now : (entry.ts ?? null);
  const entries = base.entries.slice();
  entries[index] = Object.freeze({ ...entry, undone: true, undoneAt });

  const proposed = Object.freeze({
    ...base,
    revision: (base.revision ?? 0) + 1,
    entries: Object.freeze(entries),
  });

  return ok({
    journal: proposed,
    proposal: true,
    entry: entries[index],
    patch,
  });
}

/* ------------------------------------------------------------------ *
 * Reconciliation (crash-window recovery)
 * ------------------------------------------------------------------ */

/**
 * Resolve `status: 'staged'` entries by probing live state.
 *
 * @param {object} journal
 * @param {(entry: object) => ({fieldHash: string|null}|null)} probe
 *        Pure callback supplied by the executor. Returning `null` means
 *        "unknown" — the entry is left staged.
 * @param {{now?: number}} [options]
 */
export function reconcileJournal(journal, probe, options = {}) {
  const base = journal && Array.isArray(journal.entries) ? journal : deserializeJournal(journal);
  if (!base || typeof probe !== 'function') {
    return failure(CODES.JOURNAL_INVALID, 'reconcileJournal needs a journal and a probe function.');
  }

  let changed = false;
  const entries = base.entries.map((entry) => {
    if (!entry || entry.status !== 'staged') return entry;

    let observed;
    try {
      observed = probe(entry);
    } catch {
      observed = null;
    }
    if (!observed || typeof observed.fieldHash !== 'string') return entry;

    const now = Number.isFinite(options.now) ? options.now : null;

    if (observed.fieldHash === entry.post.hash) {
      changed = true;
      return Object.freeze({ ...entry, status: 'applied', appliedAt: now });
    }
    if (observed.fieldHash === entry.pre.hash) {
      changed = true;
      return Object.freeze({
        ...entry,
        status: 'failed',
        failedAt: now,
        failureReason: 'RECONCILED_NOT_WRITTEN',
        undoable: false,
      });
    }
    changed = true;
    return Object.freeze({
      ...entry,
      status: 'diverged',
      failureReason: 'RECONCILED_DIVERGED',
      undoable: false,
    });
  });

  if (!changed) return ok({ journal: base, changed: false });

  return ok({
    journal: Object.freeze({
      ...base,
      revision: (base.revision ?? 0) + 1,
      entries: Object.freeze(entries),
    }),
    changed: true,
  });
}

/* ------------------------------------------------------------------ *
 * Transaction engine (the impure edge wrapper)
 * ------------------------------------------------------------------ */

/**
 * @param {{
 *   now?: () => number,          // required in production; host.now()
 *   entropy?: () => string,      // required in production; UUID-grade nonce
 *   sessionNonce?: string,
 *   journalLimit?: number,
 *   tokenTtlMs?: number,
 *   enforceConfirmation?: boolean,
 *   requireFixToken?: boolean,
 *   trustedQuickFix?: boolean,
 *   journal?: object,
 * }} deps
 */
export function createTxEngine(deps = {}) {
  if (deps !== null && typeof deps !== 'object') {
    throw new TypeError('createTxEngine(deps): deps must be an object');
  }

  const nowFn = typeof deps.now === 'function' ? deps.now : null;
  const entropyFn = typeof deps.entropy === 'function' ? deps.entropy : null;
  const enforceConfirmation = deps.enforceConfirmation !== false;
  const requireFixToken = deps.requireFixToken !== false;

  const warnings = [];
  let degraded = false;

  let sessionNonce = typeof deps.sessionNonce === 'string' ? deps.sessionNonce : null;
  if (!sessionNonce) {
    if (entropyFn) {
      sessionNonce = `sbp_${String(entropyFn())}`;
    } else {
      degraded = true;
      warnings.push('SESSION_NONCE_DEGRADED');
      sessionNonce = `sbp_degraded_${hashLineText('sbp-picor-degraded-nonce').slice(0, 16)}`;
    }
  }

  let journal = createJournal({
    sessionNonce,
    limit: Number.isInteger(deps.journalLimit) ? deps.journalLimit : JOURNAL_LIMIT_DEFAULT,
    entries: deps.journal?.entries ?? [],
    revision: deps.journal?.revision ?? 0,
  });

  let registry = createMintRegistry({
    sessionNonce,
    ttlMs: Number.isInteger(deps.tokenTtlMs) ? deps.tokenTtlMs : TOKEN_TTL_DEFAULT,
  });

  const clock = () => (nowFn ? Number(nowFn()) : null);

  function authorize(op, target, options) {
    if (options.fixToken == null) {
      if (!requireFixToken) return null;
      return failure(
        CODES.TOKEN_REQUIRED,
        `"${op}" requires a minted fix token (Invariant I4).`,
        { op },
      );
    }

    const now = Number.isFinite(options.now) ? options.now : clock();
    const verification = verifyFixToken(
      registry,
      options.fixToken,
      { op, target },
      { now: now ?? undefined },
    );
    if (!verification.ok) return verification;

    const consumption = consumeFixToken(registry, options.fixToken, { now: now ?? undefined });
    if (!consumption.ok) return consumption;

    registry = consumption.registry;
    return null;
  }

  function gate(op, options) {
    if (!enforceConfirmation) return null;
    return assertConfirmation(op, {
      confirmed: options.confirmed,
      trustedQuickFix: options.trustedQuickFix ?? deps.trustedQuickFix === true,
    });
  }

  function stage(entry, options) {
    const withSeq = Object.freeze({
      ...entry,
      seq: Number.isInteger(options.seq) ? options.seq : journal.entries.length + 1,
      ts: Number.isFinite(options.now) ? options.now : entry.ts,
    });
    journal = appendJournalEntry(journal, withSeq);
    return withSeq;
  }

  async function safeCall(label, fn) {
    try {
      await fn();
      return null;
    } catch (err) {
      return `${label}: ${String(err?.message ?? err)}`;
    }
  }

  const engine = {
    sessionNonce,
    degraded,
    warnings,
    enforceConfirmation,
    requireFixToken,
    safeCall,

    getJournal() {
      return journal;
    },

    getRegistry() {
      return registry;
    },

    loadJournal(next) {
      const parsed = deserializeJournal(next);
      if (!parsed) {
        return failure(CODES.JOURNAL_INVALID, 'Refusing to load a malformed journal.');
      }
      journal = parsed;
      return ok({ journal });
    },

    loadRegistry(next) {
      if (!next || next.schema !== MINT_SCHEMA || next.sessionNonce !== sessionNonce) {
        return failure(
          CODES.JOURNAL_INVALID,
          'Mint registry rejected: schema or session nonce mismatch.',
        );
      }
      registry = next;
      return ok({ registry });
    },

    /* ---- fix tokens ---- */

    mint(request, options = {}) {
      const now = Number.isFinite(options.now) ? options.now : clock();
      if (now === null) {
        return failure(
          CODES.CLOCK_UNAVAILABLE,
          'Engine has no clock; minting would produce an unverifiable token.',
        );
      }
      const result = mintFixToken(registry, request, { now });
      if (!result.ok) return result;
      registry = result.registry;
      return result;
    },

    verify(token, claim = {}, options = {}) {
      const now = Number.isFinite(options.now) ? options.now : clock();
      return verifyFixToken(registry, token, claim, { now: now ?? undefined });
    },

    consume(token, options = {}) {
      const now = Number.isFinite(options.now) ? options.now : clock();
      const result = consumeFixToken(registry, token, { now: now ?? undefined, claim: options.claim });
      if (!result.ok) return result;
      registry = result.registry;
      return result;
    },

    /* ---- operators ---- */

    muteCardLine(card, field, lineNumber, expectedHash, options = {}) {
      const op = TX_OPS.MUTE_CARD_LINE;
      const gateResult = gate(op, options);
      if (gateResult) return gateResult;

      const loc = resolveFieldLocation(card, field);
      const target = {
        kind: 'card',
        id: resolveCardId(card),
        field: loc ? loc.field : canonicalCardField(field),
        line: lineNumber,
      };

      const auth = authorize(op, target, { ...options, now: options.now ?? clock() });
      if (auth) return auth;

      const now = Number.isFinite(options.now) ? options.now : clock();
      const result = muteCardLine(card, field, lineNumber, expectedHash, {
        now: now ?? undefined,
        sessionNonce,
        seq: journal.entries.length + 1,
        fixToken: registry.issued[options.fixToken] ?? null,
        reason: options.reason,
      });
      if (!result.ok) return result;

      const entry = stage(result.entry, { now: now ?? undefined, seq: result.entry.seq });
      return ok({ card: result.card, entry, journal, field: result.field, nextLine: result.nextLine });
    },

    stripSampler(preset, parameterName, options = {}) {
      const op = TX_OPS.STRIP_SAMPLER;
      const gateResult = gate(op, options);
      if (gateResult) return gateResult;

      const target = {
        kind: 'preset',
        id: resolvePresetId(preset),
        parameter: normalizeParameterName(parameterName),
      };

      const auth = authorize(op, target, { ...options, now: options.now ?? clock() });
      if (auth) return auth;

      const now = Number.isFinite(options.now) ? options.now : clock();
      const result = stripSampler(preset, parameterName, {
        now: now ?? undefined,
        sessionNonce,
        seq: journal.entries.length + 1,
        fixToken: registry.issued[options.fixToken] ?? null,
        reason: options.reason,
      });
      if (!result.ok) return result;

      const entry = stage(result.entry, { now: now ?? undefined, seq: result.entry.seq });
      return ok({
        preset: result.preset,
        entry,
        journal,
        parameter: result.parameter,
        previousValue: result.previousValue,
      });
    },

    /* ---- lifecycle ---- */

    commit(entryId, options = {}) {
      const now = Number.isFinite(options.now) ? options.now : clock();
      const result = updateJournalEntry(journal, entryId, {
        status: 'applied',
        appliedAt: now ?? null,
      });
      if (!result.ok) return result;
      journal = result.journal;
      return result;
    },

    abort(entryId, options = {}) {
      const now = Number.isFinite(options.now) ? options.now : clock();
      const result = updateJournalEntry(journal, entryId, {
        status: 'failed',
        failedAt: now ?? null,
        failureReason: options.reason ?? 'HOST_WRITE_FAILED',
        undoable: false,
      });
      if (!result.ok) return result;
      journal = result.journal;
      return result;
    },

    undoLast(options = {}) {
      const now = Number.isFinite(options.now) ? options.now : clock();
      const result = undoLast(journal, { now: now ?? undefined, expectedFixTokenId: options.expectedFixTokenId });
      if (!result.ok) return result;
      // NOTE: `result.journal` is a proposal — call `acceptJournal()` after the
      // host write succeeds.
      return result;
    },

    /** Persist a journal produced by `undoLast()` (proposal -> committed). */
    acceptJournal(nextJournal) {
      const parsed = deserializeJournal(nextJournal);
      if (!parsed) {
        return failure(CODES.JOURNAL_INVALID, 'Refusing to accept a malformed journal.');
      }
      journal = parsed;
      return ok({ journal });
    },

    reconcile(probe, options = {}) {
      const now = Number.isFinite(options.now) ? options.now : clock();
      const result = reconcileJournal(journal, probe, { now: now ?? undefined });
      if (!result.ok) return result;
      journal = result.journal;
      return result;
    },

    serialize() {
      return serializeJournal(journal);
    },
  };

  return Object.freeze(engine);
}

/** Default export shape for `import tx from './tx.js'`. */
export default Object.freeze({
  TX_OPS,
  CODES,
  MUTE_PREFIX,
  SAMPLER_PARAMETERS,
  muteCardLine,
  stripSampler,
  undoLast,
  createTxEngine,
});
