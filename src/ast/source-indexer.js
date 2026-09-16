/**
 * SB-PICOR Alpha 2 — Source Indexer
 * =================================
 * Pure core (Invariant I1). This module MUST NOT touch `window`, `fetch`,
 * `document`, `Date.now()` or `Math.random()`. The only external dependency is
 * `node:crypto`'s `createHash`, which is referentially transparent.
 *
 * Responsibilities
 * ----------------
 *  1. Losslessly split text into lines (Invariant I8).
 *  2. Emit 1-indexed, hash-bearing line records for the 7 card text fields and
 *     for preset prompt blocks.
 *  3. Resolve anchors: exact -> relocated (±5) -> drift (Invariant I2).
 *
 * Linearity contract
 * ------------------
 *  `joinParts(splitLines(text)) === text` for EVERY string, including:
 *    ""            -> 1 part  ("" , ""        )
 *    "a"           -> 1 part  ("a", "")
 *    "a\n"         -> 2 parts ("a","\n"), ("","")
 *    "a\r\nb"      -> 2 parts ("a","\r\n"), ("b","")
 *    "a\r\rb"      -> 3 parts ("a","\r"), ("","\r"), ("b","")
 *    "a\u2028b"    -> 2 parts ("a","\u2028"), ("b","")
 *  Line numbering matches a plain `text.split(/\r\n|\r|\n|\u2028|\u2029/)`
 *  (i.e. textarea line numbers), so `field:line` citations are user-verifiable.
 */

import { createHash } from 'node:crypto';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

export const SBP_VERSION = '0.2.0-alpha.2';
export const INDEX_SCHEMA = 'sbp.index.v1';

/** Truncated digest length (hex chars) used for line/field hashes. */
export const HASH_LENGTH = 16;

export const LINE_SOURCES = Object.freeze({ CARD: 'card', PRESET: 'preset' });

export const ANCHOR_STATUS = Object.freeze({
  EXACT: 'exact',
  RELOCATED: 'relocated',
  DRIFT: 'drift',
  MISSING: 'missing',
  INVALID: 'invalid',
});

/** Only these anchor statuses may be handed to a mutator (Invariant I2). */
export const ANCHOR_ACCEPTABLE = Object.freeze([
  ANCHOR_STATUS.EXACT,
  ANCHOR_STATUS.RELOCATED,
]);

export const DEFAULT_MAX_RELOCATE_DISTANCE = 5;

/** The seven card text fields SB-PICOR indexes. Order is part of the contract. */
export const CARD_FIELDS = Object.freeze([
  'description',
  'personality',
  'scenario',
  'post_history_instructions',
  'system_prompt',
  'mes_example',
  'creator_notes',
]);

/**
 * Accepted alternate spellings found in the wild (v1 exports, hand-edited
 * cards, third-party tooling). Keys are canonical field names.
 */
export const CARD_FIELD_ALIASES = Object.freeze({
  description: Object.freeze(['char_description', 'charDescription', 'desc']),
  personality: Object.freeze(['char_personality', 'charPersonality', 'persona']),
  scenario: Object.freeze(['char_scenario', 'charScenario']),
  post_history_instructions: Object.freeze([
    'postHistoryInstructions',
    'post_history',
    'jailbreak',
  ]),
  system_prompt: Object.freeze(['systemPrompt', 'main_prompt']),
  mes_example: Object.freeze(['example_dialogue', 'exampleMessages', 'mesExample']),
  creator_notes: Object.freeze(['creatorcomment', 'creator_notes_comment', 'comment']),
});

/** Top-level preset string fields that carry instruction text. */
export const PRESET_TEXT_FIELDS = Object.freeze([
  'system_prompt',
  'main_prompt',
  'impersonation_prompt',
  'new_chat_prompt',
  'new_group_chat_prompt',
  'new_example_chat_prompt',
  'continue_nudge_prompt',
  'group_nudge_prompt',
  'wi_format',
  'scenario_format',
  'personality_format',
]);

/** Containers searched (in order) for card fields. Supports v3 `{data:{...}}`. */
const CARD_CONTAINER_PATHS = Object.freeze([
  Object.freeze([]),
  Object.freeze(['data']),
]);

/* ------------------------------------------------------------------ *
 * Small structural helpers
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

function getAtPath(root, path) {
  let cursor = root;
  for (const key of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function shallowClone(value) {
  if (Array.isArray(value)) return value.slice();
  return { ...value };
}

/** Stable `${source}::${field}` key. */
export function fieldKey(source, field) {
  return `${source}::${field}`;
}

function clip(text, max = 120) {
  const s = typeof text === 'string' ? text : '';
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/* ------------------------------------------------------------------ *
 * Hashing (deterministic, no environment access)
 * ------------------------------------------------------------------ */

const SHA256 = (input) => createHash('sha256').update(input, 'utf8').digest('hex');

/** Truncated digest of a line's text. */
export function hashText(text) {
  return SHA256(typeof text === 'string' ? text : String(text)).slice(0, HASH_LENGTH);
}

/** Full 64-char digest — used for field-level integrity checks. */
export function hashTextFull(text) {
  return SHA256(typeof text === 'string' ? text : String(text));
}

/* ------------------------------------------------------------------ *
 * Token estimation (deterministic heuristic — NOT a tokenizer)
 * ------------------------------------------------------------------ */

function isCjkCodeUnit(code) {
  return (
    (code >= 0x2e80 && code <= 0x9fff) || // CJK radicals .. unified ideographs + kana
    (code >= 0xf900 && code <= 0xfaff) || // compatibility ideographs
    (code >= 0xff66 && code <= 0xff9f) || // halfwidth kana
    (code >= 0xac00 && code <= 0xd7af) // hangul syllables
  );
}

/**
 * Approximate BPE token count.
 *  - CJK/kana/hangul: ~1 token per code unit.
 *  - Everything else: ~1 token per 4 code units.
 * Deterministic and allocation-free; suitable for budgeting and relative
 * comparison, not for billing.
 */
export function estimateTokens(text) {
  const s = typeof text === 'string' ? text : String(text ?? '');
  if (s.length === 0) return 0;
  let wide = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (isCjkCodeUnit(s.charCodeAt(i))) wide += 1;
  }
  const narrow = s.length - wide;
  return wide + Math.ceil(narrow / 4);
}

/* ------------------------------------------------------------------ *
 * Lossless line splitting (Invariant I8)
 * ------------------------------------------------------------------ */

/**
 * Split `text` into lossless parts.
 * @param {string} text
 * @returns {ReadonlyArray<{text: string, eol: string}>}
 */
export function splitLines(text) {
  if (typeof text !== 'string') {
    throw new TypeError('splitLines(text): text must be a string');
  }
  const parts = [];
  const n = text.length;
  let start = 0;
  let i = 0;

  while (i < n) {
    const code = text.charCodeAt(i);
    let eol = null;

    if (code === 13 /* \r */) {
      if (i + 1 < n && text.charCodeAt(i + 1) === 10 /* \n */) {
        eol = '\r\n';
        i += 2;
      } else {
        eol = '\r';
        i += 1;
      }
    } else if (code === 10 /* \n */) {
      eol = '\n';
      i += 1;
    } else if (code === 0x2028) {
      eol = '\u2028';
      i += 1;
    } else if (code === 0x2029) {
      eol = '\u2029';
      i += 1;
    } else {
      i += 1;
      continue;
    }

    parts.push({ text: text.slice(start, i - eol.length), eol });
    start = i;
  }

  // Always emit a final segment (possibly empty) — this is what makes the
  // model match `String.prototype.split` and therefore textarea line numbers.
  parts.push({ text: text.slice(start), eol: '' });
  return parts;
}

/**
 * Inverse of {@link splitLines}. Total on well-formed parts.
 * @param {ReadonlyArray<{text: string, eol?: string}>} parts
 * @returns {string}
 */
export function joinParts(parts) {
  if (!Array.isArray(parts)) {
    throw new TypeError('joinParts(parts): parts must be an array');
  }
  let out = '';
  for (const part of parts) {
    out += part.text + (part.eol ?? '');
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Field resolution (shared by indexer + mutator)
 * ------------------------------------------------------------------ */

/** Canonicalise any accepted spelling of a card field. Returns null if unknown. */
export function canonicalCardField(field) {
  if (typeof field !== 'string') return null;
  const needle = field.trim().toLowerCase();
  if (needle.length === 0) return null;

  for (const canonical of CARD_FIELDS) {
    if (canonical === needle) return canonical;
  }
  for (const canonical of CARD_FIELDS) {
    const aliases = CARD_FIELD_ALIASES[canonical];
    if (!aliases) continue;
    for (const alias of aliases) {
      if (alias.toLowerCase() === needle) return canonical;
    }
  }
  return null;
}

/**
 * Locate a card text field on a live (possibly v3-nested) card object.
 * @returns {null | {
 *   found: boolean, field: string, key: string|null, container: object|null,
 *   path: string[]|null, value: *, isText: boolean
 * }}
 */
export function resolveFieldLocation(card, field) {
  const canonical = CARD_FIELDS.includes(field) ? field : canonicalCardField(field);
  if (!canonical) return null;

  const candidateKeys = [canonical, ...(CARD_FIELD_ALIASES[canonical] ?? [])];

  // Pass 1a — exact key, string valued (the happy path).
  for (const containerPath of CARD_CONTAINER_PATHS) {
    const container = getAtPath(card, containerPath);
    if (!isPlainObject(container)) continue;
    for (const key of candidateKeys) {
      if (typeof container[key] === 'string') {
        return {
          found: true,
          field: canonical,
          key,
          container,
          path: [...containerPath, key],
          value: container[key],
          isText: true,
        };
      }
    }
  }

  // Pass 1b — exact key present but not a string (malformed card: report it).
  for (const containerPath of CARD_CONTAINER_PATHS) {
    const container = getAtPath(card, containerPath);
    if (!isPlainObject(container)) continue;
    for (const key of candidateKeys) {
      if (Object.prototype.hasOwnProperty.call(container, key)) {
        return {
          found: true,
          field: canonical,
          key,
          container,
          path: [...containerPath, key],
          value: container[key],
          isText: false,
        };
      }
    }
  }

  // Pass 2 — case-insensitive key match (third-party exports).
  for (const containerPath of CARD_CONTAINER_PATHS) {
    const container = getAtPath(card, containerPath);
    if (!isPlainObject(container)) continue;
    for (const key of Object.keys(container)) {
      const lower = key.toLowerCase();
      if (!candidateKeys.some((c) => c.toLowerCase() === lower)) continue;
      const value = container[key];
      return {
        found: true,
        field: canonical,
        key,
        container,
        path: [...containerPath, key],
        value,
        isText: typeof value === 'string',
      };
    }
  }

  return {
    found: false,
    field: canonical,
    key: null,
    container: null,
    path: null,
    value: undefined,
    isText: false,
  };
}

/** Convenience: string value of a card field, or null. */
export function readCardField(card, field) {
  const loc = resolveFieldLocation(card, field);
  if (!loc || !loc.found || !loc.isText) return null;
  return loc.value;
}

/**
 * Immutable write. Shallow-clones every ancestor along `path` so the caller's
 * object graph is never touched (pure core, Invariant I1/I3).
 */
export function setValueAtPath(root, path, value) {
  if (!Array.isArray(path) || path.length === 0) {
    throw new TypeError('setValueAtPath(root, path, value): path must be a non-empty array');
  }
  if (root === null || typeof root !== 'object') {
    throw new TypeError('setValueAtPath(root, ...): root must be an object');
  }

  const next = shallowClone(root);
  let nextCursor = next;
  let srcCursor = root;

  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const child = srcCursor[key];
    if (child === null || typeof child !== 'object') {
      throw new TypeError(
        `setValueAtPath: cannot descend into non-object at path segment "${key}"`,
      );
    }
    const childClone = shallowClone(child);
    nextCursor[key] = childClone;
    nextCursor = childClone;
    srcCursor = child;
  }

  nextCursor[path[path.length - 1]] = value;
  return next;
}

/** Immutable delete counterpart of {@link setValueAtPath}. */
export function omitValueAtPath(root, path) {
  if (!Array.isArray(path) || path.length === 0) {
    throw new TypeError('omitValueAtPath(root, path): path must be a non-empty array');
  }
  if (root === null || typeof root !== 'object') {
    throw new TypeError('omitValueAtPath(root, ...): root must be an object');
  }

  const next = shallowClone(root);
  let nextCursor = next;
  let srcCursor = root;

  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const child = srcCursor[key];
    if (child === null || typeof child !== 'object') {
      throw new TypeError(
        `omitValueAtPath: cannot descend into non-object at path segment "${key}"`,
      );
    }
    const childClone = shallowClone(child);
    nextCursor[key] = childClone;
    nextCursor = childClone;
    srcCursor = child;
  }

  delete nextCursor[path[path.length - 1]];
  return next;
}

/* ------------------------------------------------------------------ *
 * Line indexing
 * ------------------------------------------------------------------ */

function makeLine(source, field, lineNo, ordinal, part, charStart, meta) {
  const charEnd = charStart + part.text.length;
  return Object.freeze({
    source,
    field,
    line: lineNo,
    ordinal,
    text: part.text,
    eol: part.eol,
    hash: hashText(part.text),
    tokenEstimate: estimateTokens(part.text),
    charStart,
    charEnd,
    blank: part.text.trim().length === 0,
    meta: meta ?? null,
  });
}

/**
 * Index a single text blob into frozen line records.
 * @param {'card'|'preset'} source
 * @param {string} field
 * @param {string} text
 * @param {{firstOrdinal?: number, meta?: object|null}} [options]
 */
export function indexField(source, field, text, options = {}) {
  if (typeof field !== 'string' || field.length === 0) {
    throw new TypeError('indexField(source, field, text): field must be a non-empty string');
  }
  const parts = splitLines(text);
  const firstOrdinal = Number.isInteger(options.firstOrdinal) ? options.firstOrdinal : 0;
  const meta = options.meta ? Object.freeze({ ...options.meta }) : null;

  const lines = new Array(parts.length);
  let charCursor = 0;

  for (let i = 0; i < parts.length; i += 1) {
    const line = makeLine(source, field, i + 1, firstOrdinal + i, parts[i], charCursor, meta);
    lines[i] = line;
    charCursor = line.charEnd + parts[i].eol.length;
  }

  return Object.freeze(lines);
}

/**
 * Index all seven card text fields.
 * @returns {ReadonlyArray<object>} frozen line records, contiguous per field
 */
export function indexCard(card, options = {}) {
  if (card === null || typeof card !== 'object') {
    throw new TypeError('indexCard(card): card must be an object');
  }
  const out = [];
  let ordinal = Number.isInteger(options.firstOrdinal) ? options.firstOrdinal : 0;

  for (const field of CARD_FIELDS) {
    const loc = resolveFieldLocation(card, field);
    if (!loc || !loc.found || !loc.isText) continue;
    const lines = indexField(LINE_SOURCES.CARD, field, loc.value, { firstOrdinal: ordinal });
    ordinal += lines.length;
    out.push(...lines);
  }

  return out;
}

export const indexCardFields = indexCard;

function sanitizeBlockKey(raw) {
  const s = String(raw ?? '').trim();
  const cleaned = s.replace(/[\][\s]+/g, '_');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Enumerate the indexable text blocks of a preset.
 * @returns {Array<{field: string, text: string, meta: object|null}>}
 */
export function enumeratePresetBlocks(preset, options = {}) {
  if (preset === null || typeof preset !== 'object') {
    throw new TypeError('enumeratePresetBlocks(preset): preset must be an object');
  }
  const includeDisabled = options.includeDisabled !== false;
  const blocks = [];

  const prompts = preset.prompts;
  if (Array.isArray(prompts) || isPlainObject(prompts)) {
    const entries = Array.isArray(prompts)
      ? prompts.map((entry, index) => [String(index), entry])
      : Object.entries(prompts);

    const used = Object.create(null);
    for (const [fallbackIndex, entry] of entries) {
      if (!isPlainObject(entry)) continue;
      const text =
        typeof entry.content === 'string'
          ? entry.content
          : typeof entry.system_prompt === 'string'
            ? entry.system_prompt
            : null;
      if (text === null) continue;

      const enabled = entry.enabled !== false;
      if (!enabled && !includeDisabled) continue;

      let key = sanitizeBlockKey(entry.identifier ?? entry.name ?? fallbackIndex);
      if (!key) key = sanitizeBlockKey(fallbackIndex) ?? 'block';
      if (used[key]) {
        let n = 2;
        while (used[`${key}_${n}`]) n += 1;
        key = `${key}_${n}`;
      }
      used[key] = true;

      blocks.push({
        field: `prompts[${key}].content`,
        text,
        meta: {
          kind: 'preset_prompt',
          key,
          index: Array.isArray(prompts) ? Number(fallbackIndex) : null,
          identifier: typeof entry.identifier === 'string' ? entry.identifier : null,
          name: typeof entry.name === 'string' ? entry.name : null,
          role: typeof entry.role === 'string' ? entry.role : null,
          enabled,
          injection_depth: Number.isInteger(entry.injection_depth) ? entry.injection_depth : null,
          injection_position: Number.isInteger(entry.injection_position)
            ? entry.injection_position
            : null,
        },
      });
    }
  }

  for (const field of PRESET_TEXT_FIELDS) {
    const value = preset[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    blocks.push({
      field,
      text: value,
      meta: Object.freeze({ kind: 'preset_field', key: field, enabled: true }),
    });
  }

  return blocks;
}

/** Index all indexable text of a preset. */
export function indexPreset(preset, options = {}) {
  const blocks = enumeratePresetBlocks(preset, options);
  const out = [];
  let ordinal = Number.isInteger(options.firstOrdinal) ? options.firstOrdinal : 0;

  for (const block of blocks) {
    const lines = indexField(LINE_SOURCES.PRESET, block.field, block.text, {
      firstOrdinal: ordinal,
      meta: block.meta,
    });
    ordinal += lines.length;
    out.push(...lines);
  }

  return out;
}

/**
 * Collapse a flat, field-contiguous line array into an index document.
 * Requires lines of the same `source::field` to be contiguous.
 * @param {ReadonlyArray<object>} lines
 */
export function finalizeIndex(lines) {
  const frozenLines = Object.freeze(lines.slice());
  const fields = [];
  const byKey = Object.create(null);

  let current = null;
  for (let i = 0; i < frozenLines.length; i += 1) {
    const line = frozenLines[i];
    const key = fieldKey(line.source, line.field);

    if (current === null || current.key !== key) {
      current = {
        key,
        source: line.source,
        field: line.field,
        startIndex: i,
        endIndex: i,
        lineCount: 0,
        charCount: 0,
        tokenEstimate: 0,
        hash: '',
        _chunks: [],
        meta: line.meta ?? null,
      };
      fields.push(current);
      byKey[key] = current;
    }

    current.endIndex = i;
    current.lineCount += 1;
    current.charCount += line.text.length + line.eol.length;
    current.tokenEstimate += line.tokenEstimate;
    current._chunks.push(line.text + line.eol);
  }

  for (const field of fields) {
    field.hash = hashText(field._chunks.join(''));
    delete field._chunks;
    Object.freeze(field);
  }

  const totalTokens = fields.reduce((sum, f) => sum + f.tokenEstimate, 0);

  return Object.freeze({
    schema: INDEX_SCHEMA,
    version: SBP_VERSION,
    lines: frozenLines,
    fields: Object.freeze(fields),
    index: Object.freeze(byKey),
    lineCount: frozenLines.length,
    tokenEstimate: totalTokens,
  });
}

/**
 * Build a complete index for a card and/or preset.
 * @param {{card?: object|null, preset?: object|null, options?: object}} [input]
 */
export function buildIndex(input = {}) {
  const { card = null, preset = null, options = {} } = input;
  const lines = [];
  let ordinal = 0;

  if (card) {
    const cardLines = indexCard(card, { firstOrdinal: ordinal });
    ordinal += cardLines.length;
    lines.push(...cardLines);
  }
  if (preset) {
    const presetLines = indexPreset(preset, { firstOrdinal: ordinal, ...options });
    ordinal += presetLines.length;
    lines.push(...presetLines);
  }

  return finalizeIndex(lines);
}

/**
 * Slice the lines belonging to one field out of an index (or a raw array).
 * @param {object|ReadonlyArray<object>} indexOrLines
 * @param {'card'|'preset'} source
 * @param {string} field
 */
export function linesForField(indexOrLines, source, field) {
  if (indexOrLines && Array.isArray(indexOrLines.lines) && indexOrLines.index) {
    const record = indexOrLines.index[fieldKey(source, field)];
    if (!record) return [];
    return indexOrLines.lines.slice(record.startIndex, record.endIndex + 1);
  }
  const lines = Array.isArray(indexOrLines) ? indexOrLines : [];
  return lines.filter((line) => line.source === source && line.field === field);
}

/* ------------------------------------------------------------------ *
 * Anchor resolution (Invariant I2)
 * ------------------------------------------------------------------ */

/** Mint an anchor record from an indexed line. */
export function makeAnchor(line) {
  if (!line || typeof line !== 'object') {
    throw new TypeError('makeAnchor(line): line must be a line record');
  }
  return Object.freeze({
    source: line.source,
    field: line.field,
    line: line.line,
    hash: line.hash,
    text: line.text,
    tokenEstimate: line.tokenEstimate,
  });
}

/** True when an anchor result is safe to hand to the executor. */
export function isAnchorAcceptable(result) {
  return (
    !!result &&
    !!result.ok &&
    ANCHOR_ACCEPTABLE.includes(result.status)
  );
}

function anchorInvalid(anchor, reason, details) {
  return {
    status: ANCHOR_STATUS.INVALID,
    ok: false,
    reason,
    details: details ?? null,
    anchor: anchor ?? null,
    line: null,
    entry: null,
    delta: null,
    observed: null,
    candidates: null,
  };
}

function anchorMatched(status, candidate, delta, anchor, candidates) {
  const ambiguous =
    Array.isArray(candidates) && candidates.length > 1;

  return {
    status,
    ok: true,
    reason: null,
    details: null,
    anchor,
    line: candidate.line,
    entry: candidate,
    delta,
    moved: delta !== 0,
    ambiguous,
    observed: null,
    candidates: candidates
      ? candidates.map((c) => ({ line: c.line, delta: c.delta, hash: c.hash }))
      : null,
  };
}

/**
 * Resolve an anchor against an index or a raw line array.
 *
 *   exact      — line N of the field still hashes to `anchor.hash`
 *   relocated  — a line within ±`maxRelocateDistance` matches
 *   drift      — no match; the executor MUST refuse (Invariant I2)
 *   missing    — the field is not indexed at all
 *   invalid    — the anchor is malformed
 *
 * @param {object|ReadonlyArray<object>} lines
 * @param {{source?: string, field: string, line: number, hash: string, text?: string}} anchor
 * @param {{maxRelocateDistance?: number}} [options]
 */
export function resolveAnchor(lines, anchor, options = {}) {
  const maxDistance = Number.isInteger(options.maxRelocateDistance)
    ? options.maxRelocateDistance
    : DEFAULT_MAX_RELOCATE_DISTANCE;

  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) {
    return anchorInvalid(anchor, 'ANCHOR_NOT_OBJECT');
  }

  const source = anchor.source ?? LINE_SOURCES.CARD;
  if (source !== LINE_SOURCES.CARD && source !== LINE_SOURCES.PRESET) {
    return anchorInvalid(anchor, 'ANCHOR_SOURCE_UNKNOWN', { source });
  }

  const field = anchor.field;
  if (typeof field !== 'string' || field.length === 0) {
    return anchorInvalid(anchor, 'ANCHOR_FIELD_MISSING');
  }
  if (!Number.isInteger(anchor.line) || anchor.line < 1) {
    return anchorInvalid(anchor, 'ANCHOR_LINE_INVALID', { line: anchor.line });
  }
  if (typeof anchor.hash !== 'string' || anchor.hash.length === 0) {
    return anchorInvalid(anchor, 'ANCHOR_HASH_MISSING');
  }

  const scoped = linesForField(lines, source, field);
  if (scoped.length === 0) {
    return {
      status: ANCHOR_STATUS.MISSING,
      ok: false,
      reason: 'FIELD_NOT_INDEXED',
      details: { source, field },
      anchor,
      line: null,
      entry: null,
      delta: null,
      observed: null,
      candidates: null,
    };
  }

  const wantsText = typeof anchor.text === 'string';
  const matches = (line) =>
    line.hash === anchor.hash && (!wantsText || line.text === anchor.text);

  const targetIndex = anchor.line - 1;

  // --- 1. exact ---------------------------------------------------------
  if (targetIndex >= 0 && targetIndex < scoped.length) {
    const atTarget = scoped[targetIndex];
    if (matches(atTarget)) {
      return anchorMatched(ANCHOR_STATUS.EXACT, atTarget, 0, anchor, null);
    }
  }

  // --- 2. relocated (±maxDistance) --------------------------------------
  const candidates = [];
  for (let delta = -maxDistance; delta <= maxDistance; delta += 1) {
    if (delta === 0) continue;
    const index = targetIndex + delta;
    if (index < 0 || index >= scoped.length) continue;
    const candidate = scoped[index];
    if (!matches(candidate)) continue;
    candidates.push({ line: candidate.line, delta, hash: candidate.hash, entry: candidate });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.delta - b.delta);
    const best = candidates[0];
    return anchorMatched(ANCHOR_STATUS.RELOCATED, best.entry, best.delta, anchor, candidates);
  }

  // --- 3. drift ---------------------------------------------------------
  const observed =
    targetIndex >= 0 && targetIndex < scoped.length
      ? scoped[targetIndex]
      : null;

  return {
    status: ANCHOR_STATUS.DRIFT,
    ok: false,
    reason: observed ? 'CONTENT_CHANGED' : 'LINE_OUT_OF_RANGE',
    details: {
      source,
      field,
      line: anchor.line,
      fieldLineCount: scoped.length,
      maxRelocateDistance: maxDistance,
      expectedHash: anchor.hash,
    },
    anchor,
    line: null,
    entry: null,
    delta: null,
    observed: observed
      ? { line: observed.line, hash: observed.hash, preview: clip(observed.text) }
      : null,
    candidates: null,
  };
}

/**
 * Resolve many anchors at once; returns results in input order.
 */
export function resolveAnchors(lines, anchors, options = {}) {
  if (!Array.isArray(anchors)) {
    throw new TypeError('resolveAnchors(lines, anchors): anchors must be an array');
  }
  return anchors.map((anchor) => resolveAnchor(lines, anchor, options));
}

/** Self-check used by tests and by CI (Invariant I8). */
export function assertRoundTrip(text) {
  const parts = splitLines(text);
  const rejoined = joinParts(parts);
  if (rejoined !== text) {
    throw new Error(
      `SB-PICOR I8 violation: joinParts(splitLines(x)) !== x (len ${text.length})`,
    );
  }
  return parts.length;
}
