/**
 * SB-PICOR Alpha 2 — Card Audit (linter)
 * =====================================================================
 * Field-level audit of a SillyTavern / PICOR style character card.
 *
 * Uses `indexCardFields` from the AST source indexer to obtain stable
 * field boundaries and hashes, then emits findings carrying the exact
 * shape the mutation transaction layer consumes:
 *
 *   { field, line, hash, text, fixToken, ruleLabel, snippet }
 *
 * `hash` is the field hash reported by the indexer (or derived locally
 * when the indexer is unavailable) so `src/mutate/tx.js` can re-resolve
 * the target field without re-parsing.
 *
 * Two headline rules are implemented here:
 *   • OOC Gag Trap            — mandated catchphrases / repetition loops.
 *   • Negative Constraint Fatigue — stacks of "do not" clauses that
 *                                    silently destroy adherence.
 * =====================================================================
 */

import { indexCardFields } from '../ast/source-indexer.js';

export const AUDIT_VERSION = 'alpha-2';

/* ====================================================================== *
 * Hashing
 * ====================================================================== */

/**
 * Deterministic 64-bit-ish (2 × 32-bit) FNV/Murmur hybrid hash.
 * Returns 16 lowercase hex characters.
 */
export function hashText(input) {
  const text = String(input ?? '');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/* ====================================================================== *
 * Source map
 * ====================================================================== */

class SourceMap {
  constructor(source) {
    this.source = String(source ?? '');
    this.starts = [0];
    for (let i = 0; i < this.source.length; i += 1) {
      if (this.source.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }

  get lineCount() {
    return this.starts.length;
  }

  /** 1-based line number containing `offset`, or null. */
  lineAt(offset) {
    if (!Number.isFinite(offset) || offset < 0 || offset > this.source.length) return null;
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  offsetOf(needle, from = 0) {
    if (!needle) return -1;
    return this.source.indexOf(needle, from);
  }
}

/* ====================================================================== *
 * Index normalization
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
    if (typeof value.value === 'string') return value.value;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function normalizeFieldRecord(record, index, lineBase = 1) {
  const rec = isPlainObject(record) ? record : { text: asText(record) };

  const name =
    rec.field ?? rec.path ?? rec.name ?? rec.key ?? rec.id ?? rec.label ?? (index === 0 ? 'root' : `field_${index}`);

  const text =
    typeof rec.text === 'string'
      ? rec.text
      : typeof rec.value === 'string'
        ? rec.value
        : typeof rec.raw === 'string'
          ? rec.raw
          : typeof rec.content === 'string'
            ? rec.content
            : asText(rec.value ?? rec.raw ?? '');

  let line =
    firstNumber(
      rec.line,
      rec.startLine,
      rec.start_line,
      rec.lineno,
      rec.lineNumber,
      typeof rec.start === 'number' ? rec.start : null,
      rec.start && typeof rec.start === 'object' ? rec.start.line : null,
      rec.range && rec.range.start ? rec.range.start.line : null,
    ) ?? 1;

  if (line === 0) line = 1;
  if (lineBase === 0) line += 1;

  const hash = String(rec.hash ?? rec.valueHash ?? rec.digest ?? hashText(text || `${name}:${index}`));

  return {
    field: String(name),
    line,
    hash,
    text,
    offset: -1,
  };
}

/** Heuristic fallback indexer for when `indexCardFields` is unavailable. */
function deriveFieldsFromSource(source) {
  const lines = String(source ?? '').split(/\r?\n/);
  const fields = [];
  let current = null;

  const flush = () => {
    if (current && current.text.trim()) fields.push(current);
    current = null;
  };

  lines.forEach((line, index) => {
    const kv = line.match(/^\s*(?:"([\w .-]+)"|'([\w .-]+)'|([A-Za-z][\w .-]*))\s*:\s*(.*)$/);
    if (kv) {
      flush();
      const key = (kv[1] ?? kv[2] ?? kv[3] ?? 'root').trim();
      current = { field: key, line: index + 1, text: (kv[4] ?? '').replace(/,\s*$/, '') };
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line;
    } else if (line.trim()) {
      current = { field: 'root', line: index + 1, text: line };
    }
  });
  flush();

  if (!fields.length && String(source ?? '').trim()) {
    fields.push({ field: 'root', line: 1, text: String(source) });
  }

  return fields.map((f, i) => ({ ...f, hash: hashText(f.text || `root:${i}`), offset: -1 }));
}

function runIndexer(source, options) {
  if (typeof indexCardFields !== 'function') return null;
  const attempts = [() => indexCardFields(source), () => indexCardFields(source, options)];
  for (const attempt of attempts) {
    try {
      const out = attempt();
      if (out) return out;
    } catch {
      /* try the next call shape */
    }
  }
  return null;
}

function normalizeIndexResult(indexResult, source, rawCard, options) {
  const lineBase = Number.isInteger(options.lineBase) ? options.lineBase : 1;

  if (Array.isArray(indexResult)) {
    return { fields: indexResult.map((r, i) => normalizeFieldRecord(r, i, lineBase)), indexerUsed: true };
  }

  if (isPlainObject(indexResult)) {
    const bucket = indexResult.fields ?? indexResult.entries ?? indexResult.index ?? indexResult.records ?? null;
    if (Array.isArray(bucket)) {
      return { fields: bucket.map((r, i) => normalizeFieldRecord(r, i, lineBase)), indexerUsed: true };
    }
  }

  if (isPlainObject(rawCard) && !source) {
    const fields = Object.entries(rawCard)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value], i) => normalizeFieldRecord({ field: key, text: asText(value) }, i, lineBase));
    return { fields, indexerUsed: false };
  }

  return { fields: deriveFieldsFromSource(source), indexerUsed: false };
}

/* ====================================================================== *
 * Scan helpers
 * ====================================================================== */

const NEGATION_RE = /\b(?:do not|don'?t|never|avoid|must not|mustn'?t|should not|shouldn'?t|can'?t|cannot|refrain from|no longer|stop being|without ever)\b/gi;

function collectMatches(pattern, text, limit = 200) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  let re;
  try {
    re = new RegExp(pattern.source, flags);
  } catch {
    return [];
  }
  const out = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    out.push({ index: match.index, value: match[0], length: match[0].length, groups: match.slice(1) });
    if (match[0] === '') re.lastIndex += 1;
    if (out.length >= limit) break;
  }
  return out;
}

function snippetAround(text, index, length, radius = 44) {
  const body = String(text ?? '');
  if (!body) return '';
  const safeIndex = Math.max(0, Math.min(index ?? 0, Math.max(0, body.length - 1)));
  const start = Math.max(0, safeIndex - radius);
  const end = Math.min(body.length, safeIndex + (length ?? 0) + radius);
  const core = body.slice(start, end).replace(/\s+/g, ' ').trim();
  if (!core) return '';
  return `${start > 0 ? '…' : ''}${core}${end < body.length ? '…' : ''}`;
}

function lineFor(field, localIndex, sourceMap) {
  if (field.offset >= 0 && Number.isFinite(localIndex)) {
    const line = sourceMap.lineAt(field.offset + Math.max(0, localIndex));
    if (line) return line;
  }
  return field.line;
}

function makeFinding({ field, line, hash, text, fixToken, ruleLabel, snippet }) {
  return { field, line, hash, text, fixToken, ruleLabel, snippet };
}

/* ====================================================================== *
 * Rules
 * ====================================================================== */

const KNOWN_MACROS = new Set([
  'char', 'user', 'persona', 'description', 'scenario', 'personality', 'system',
  'time', 'date', 'isodate', 'weekday', 'input', 'model', 'original', 'random',
  'pick', 'roll', 'newline', 'space', '//', 'trim', 'join', 'if', 'else', 'endif',
]);

function xmlImbalance(text) {
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*)(\/?)>/g;
  const stack = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    const closing = match[1] === '/';
    const tag = match[2];
    const selfClosing = match[4] === '/';
    if (selfClosing || /\bxml\b/i.test(tag)) continue;
    if (closing) {
      const top = stack.pop();
      if (!top) return { index: match.index, length: match[0].length, detail: `stray closing tag </${tag}>` };
      if (top.tag.toLowerCase() !== tag.toLowerCase()) {
        return {
          index: match.index,
          length: match[0].length,
          detail: `</${tag}> closes <${top.tag}>`,
        };
      }
    } else {
      stack.push({ tag, index: match.index });
    }
  }
  if (stack.length) {
    const top = stack[0];
    return { index: top.index, length: top.tag.length + 2, detail: `<${top.tag}> is never closed` };
  }
  return null;
}

export const RULES = Object.freeze([
  {
    id: 'OOC-GAG-TRAP',
    label: 'OOC Gag Trap',
    fixToken: 'DISSOLVE-GAG-TRAP',
    severity: 'high',
    kind: 'pattern',
    max: 4,
    pattern:
      /(?:never|under no circumstances|do not|refrain from|strictly forbid\w*)\s+(?:break character|leave character|stop roleplay\w*|step out of character|acknowledge (?:being|that you are) an? (?:ai|assistant|bot)|admit to being an? (?:ai|bot)|speak as assistant)|\b(?:catchphrase|running joke|signature (?:line|phrase|quip)|verbal tic|recurring gag|mantra|tagline)\b/gi,
    description:
      'Rigid behavioral locks or phrase mandates that gag the model during OOC queries or collapse roleplay into loops.',
  },
  {
    id: 'NEG-CONSTRAINT-FATIGUE',
    label: 'Negative Constraint Fatigue',
    fixToken: 'POSITIVE-REFRAME',
    severity: 'high',
    kind: 'scan',
    description:
      'Stacked prohibitions ("do not", "never", "avoid"). Adherence decays sharply past roughly four negations in one field; positive reframing restores steer.',
    scan(field, ctx) {
      const hits = collectMatches(NEGATION_RE, field.text);
      const base = Number.isFinite(ctx.options.negationThreshold) ? ctx.options.negationThreshold : 4;
      const threshold = field.text.length > 1200 ? base + 2 : base;
      if (hits.length < threshold) return [];
      const sample = hits.slice(0, 5).map((h) => h.value.toLowerCase()).join(', ');
      return [
        {
          index: hits[0].index,
          length: hits[0].value.length,
          snippet: `${hits.length} negative constraints (${sample}${hits.length > 5 ? ', …' : ''})`,
          count: hits.length,
        },
      ];
    },
  },
  {
    id: 'USER-AGENCY-OVERRIDE',
    label: 'User Agency Override',
    fixToken: 'PROTECT-USER-AGENCY',
    severity: 'high',
    kind: 'pattern',
    max: 6,
    pattern:
      /\b(?:speak|act|decide|respond|write|narrate|think|feel)\w*\s+(?:for|as)\s+(?:the\s+)?(?:user|player)\b|\b(?:control|puppet)\w*\s+the\s+(?:user|player)\b/gi,
    description: 'The card instructs the model to act for the user, which breaks player agency and immersion.',
  },
  {
    id: 'SAMPLER-LEAK',
    label: 'Sampler Leakage',
    fixToken: 'STRIP-SAMPLER',
    severity: 'medium',
    kind: 'pattern',
    max: 8,
    pattern:
      /\b(?:temperature|top[_-]?p|top[_-]?k|min[_-]?p|typical[_-]?p|tfs[_-]?z|mirostat(?:_tau|_eta)?|repetition[_-]?penalty|frequency[_-]?penalty|presence[_-]?penalty|max[_-]?tokens|num[_-]?predict)\s*(?:[:=]|of|at)\s*[0-9]*\.?[0-9]+/gi,
    description: 'Runtime sampler configuration pasted into card prose. Targets either ignore it or echo it verbatim.',
  },
  {
    id: 'PLACEHOLDER-TEXT',
    label: 'Placeholder Text',
    fixToken: 'REMOVE-PLACEHOLDER',
    severity: 'medium',
    kind: 'pattern',
    max: 8,
    pattern:
      /\b(?:TODO|FIXME|XXX|TBD|lorem ipsum|placeholder)\b|\[\s*(?:insert|add|fill in|your [a-z ]+ here)\b[^\]]*\]/gi,
    description: 'Unfinished scaffold text that should never reach a production card.',
  },
  {
    id: 'HEDGE-DIRECTIVE',
    label: 'Hedged Directive',
    fixToken: 'TIGHTEN-DIRECTIVE',
    severity: 'low',
    kind: 'pattern',
    max: 8,
    pattern: /\b(?:try to|maybe|perhaps|if possible|feel free to|kind of|sort of|might want to|should probably)\b/gi,
    description: 'Hedged instructions dilute the steer; imperatives produce measurably tighter behaviour.',
  },
  {
    id: 'UNRESOLVED-MACRO',
    label: 'Unresolved Macro',
    fixToken: 'RESOLVE-MACRO',
    severity: 'medium',
    kind: 'pattern',
    max: 10,
    pattern: /\{\{\s*([a-z0-9_./-]+)\s*\}\}/gi,
    description: 'Macro is not part of the known substitution set and will surface literally in the prompt.',
    filter(match) {
      return !KNOWN_MACROS.has(String(match.groups?.[0] ?? '').toLowerCase());
    },
  },
  {
    id: 'XML-IMBALANCE',
    label: 'Unbalanced XML Block',
    fixToken: 'BALANCE-XML',
    severity: 'medium',
    kind: 'scan',
    description: 'An opening tag has no matching close (or vice versa); sectioning will not survive compilation.',
    scan(field) {
      const problem = xmlImbalance(field.text);
      if (!problem) return [];
      return [{ index: problem.index, length: problem.length, snippet: problem.detail }];
    },
  },
  {
    id: 'TOKEN-BLOAT',
    label: 'Field Token Bloat',
    fixToken: 'TRIM-FIELD',
    severity: 'low',
    kind: 'scan',
    description: 'Oversized single field. Long undifferentiated blocks dilute attention across the card.',
    scan(field, ctx) {
      const budget = Number.isFinite(ctx.options.maxFieldChars) ? ctx.options.maxFieldChars : 2000;
      if (field.text.length <= budget) return [];
      return [
        {
          index: 0,
          length: 0,
          snippet: `${field.text.length} chars (budget ${budget}) · ${field.text.slice(0, 80).replace(/\s+/g, ' ').trim()}…`,
        },
      ];
    },
  },
  {
    id: 'EMPTY-FIELD',
    label: 'Empty Field',
    fixToken: 'DROP-EMPTY-FIELD',
    severity: 'low',
    kind: 'scan',
    description: 'Empty field consumes prompt budget without producing steer.',
    scan(field) {
      if (field.field === 'root') return [];
      if (field.text.trim().length > 0) return [];
      return [{ index: 0, length: 0, snippet: '(empty field)' }];
    },
  },
]);

const DUPLICATE_RULE = Object.freeze({
  id: 'DUPLICATE-FIELD',
  label: 'Duplicate Field Content',
  fixToken: 'DEDUPE-FIELD',
  severity: 'medium',
  description: 'Two fields carry identical content; they compete with themselves for attention weight.',
});

export const RULE_LABELS = Object.freeze(RULES.map((r) => r.label));
export const FIX_TOKENS = Object.freeze([...new Set(RULES.map((r) => r.fixToken).concat(DUPLICATE_RULE.fixToken))]);

/* ====================================================================== *
 * Audit
 * ====================================================================== */

function resolveSource(card) {
  if (typeof card === 'string') return card;
  if (!isPlainObject(card)) return '';
  for (const key of ['text', 'raw', 'source', 'body', 'content', 'cardSource']) {
    if (typeof card[key] === 'string' && card[key].trim()) return card[key];
  }
  return '';
}

function scanField(field, ctx) {
  for (const rule of RULES) {
    let hits = [];

    if (rule.kind === 'pattern') {
      hits = collectMatches(rule.pattern, field.text, rule.max ?? 12);
      if (typeof rule.filter === 'function') hits = hits.filter((hit) => rule.filter(hit));
      hits = hits.slice(0, rule.max ?? 12);
    } else if (typeof rule.scan === 'function') {
      hits = rule.scan(field, ctx) ?? [];
    }

    if (!hits.length) continue;

    for (const hit of hits) {
      const line = lineFor(field, hit.index, ctx.sourceMap);
      const snippet =
        hit.snippet ??
        snippetAround(field.text, hit.index, hit.length ?? (hit.value ? hit.value.length : 0));

      ctx.push(
        makeFinding({
          field: field.field,
          line,
          hash: field.hash,
          text: field.text,
          fixToken: rule.fixToken,
          ruleLabel: rule.label,
          snippet,
        }),
      );
    }
  }
}

function scanDuplicates(fields, ctx) {
  const byHash = new Map();
  for (const field of fields) {
    if (!field.text.trim()) continue;
    if (!byHash.has(field.hash)) byHash.set(field.hash, []);
    byHash.get(field.hash).push(field);
  }

  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group;
    for (const field of rest) {
      ctx.push(
        makeFinding({
          field: field.field,
          line: field.line,
          hash: field.hash,
          text: field.text,
          fixToken: DUPLICATE_RULE.fixToken,
          ruleLabel: DUPLICATE_RULE.label,
          snippet: `duplicate of "${first.field}" (line ${first.line})`,
        }),
      );
    }
  }
}

function sortFindings(findings) {
  return findings.sort(
    (a, b) =>
      a.line - b.line ||
      a.field.localeCompare(b.field) ||
      a.ruleLabel.localeCompare(b.ruleLabel) ||
      a.snippet.localeCompare(b.snippet),
  );
}

function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const finding of findings) {
    const key = `${finding.field}|${finding.line}|${finding.ruleLabel}|${finding.fixToken}|${finding.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

/**
 * Audit a character card.
 *
 * @param {string|object} card      Raw card text, or a parsed card object.
 * @param {object} [options]
 * @param {string} [options.cardName]
 * @param {number} [options.maxFieldChars=2000]
 * @param {number} [options.negationThreshold=4]
 * @param {number} [options.lineBase=1]   0 if the indexer reports 0-based lines.
 * @returns {object}
 */
export function auditCard(card, options = {}) {
  const source = resolveSource(card);
  const rawCard = isPlainObject(card) ? card : null;

  let indexResult = null;
  let indexerUsed = false;

  if (rawCard) {
    indexResult = runIndexer(rawCard, options);
  } else if (source) {
    indexResult = runIndexer(source, options);
  }

  const normalized = normalizeIndexResult(indexResult, source, rawCard, options);
  indexerUsed = normalized.indexerUsed;
  const fields = normalized.fields;
  const sourceMap = new SourceMap(source);

  /* Resolve absolute offsets so match-local indices map to real lines. */
  let searchFrom = 0;
  for (const field of fields) {
    if (!source) break;
    const offset = sourceMap.offsetOf(field.text, searchFrom);
    if (offset >= 0) {
      field.offset = offset;
      searchFrom = offset + Math.max(1, field.text.length);
    } else {
      field.offset = -1;
    }
  }

  const findings = [];
  const ctx = {
    options,
    sourceMap,
    indexerUsed,
    push: (finding) => findings.push(finding),
  };

  for (const field of fields) scanField(field, ctx);
  scanDuplicates(fields, ctx);

  const finalFindings = sortFindings(dedupeFindings(findings));

  /* ---- stats ------------------------------------------------------- */
  const byRule = {};
  const byField = {};
  const bySeverity = {};
  const severityById = new Map(RULES.map((r) => [r.label, r.severity]).concat([[DUPLICATE_RULE.label, DUPLICATE_RULE.severity]]));

  let negativeConstraints = 0;
  let gagTraps = 0;

  for (const finding of finalFindings) {
    byRule[finding.ruleLabel] = (byRule[finding.ruleLabel] ?? 0) + 1;
    byField[finding.field] = (byField[finding.field] ?? 0) + 1;
    const severity = severityById.get(finding.ruleLabel) ?? 'info';
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    if (finding.ruleLabel === 'Negative Constraint Fatigue') {
      const count = Number((finding.snippet.match(/^(\d+)\s+negative/) ?? [])[1] ?? 0);
      negativeConstraints += count;
    }
    if (finding.ruleLabel === 'OOC Gag Trap') gagTraps += 1;
  }

  return {
    ok: true,
    version: AUDIT_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      chars: source.length,
      lines: sourceMap.lineCount,
      hash: hashText(source),
      indexerUsed,
    },
    card: {
      name: options.cardName ?? rawCard?.name ?? rawCard?.data?.name ?? null,
      fieldCount: fields.length,
      fields: fields.map((f) => ({ field: f.field, line: f.line, hash: f.hash, chars: f.text.length })),
    },
    findings: finalFindings,
    stats: {
      total: finalFindings.length,
      byRule,
      byField,
      bySeverity,
      fixTokens: [...new Set(finalFindings.map((f) => f.fixToken))],
      negativeConstraints,
      gagTraps,
      indexerFailed: !indexerUsed && Boolean(source),
    },
  };
}

/**
 * Audit an already-normalized field list (skip the source indexer).
 * Field records accept `{ field, line, hash, text }`.
 */
export function auditCardFields(fields = [], options = {}) {
  const normalized = fields.map((record, index) => normalizeFieldRecord(record, index, options.lineBase ?? 1));
  const source = options.source ?? '';
  const sourceMap = new SourceMap(source);

  if (source) {
    let searchFrom = 0;
    for (const field of normalized) {
      const offset = sourceMap.offsetOf(field.text, searchFrom);
      if (offset >= 0) {
        field.offset = offset;
        searchFrom = offset + Math.max(1, field.text.length);
      }
    }
  }

  const findings = [];
  const ctx = { options, sourceMap, indexerUsed: false, push: (f) => findings.push(f) };
  for (const field of normalized) scanField(field, ctx);
  scanDuplicates(normalized, ctx);

  const finalFindings = sortFindings(dedupeFindings(findings));
  return {
    ok: true,
    version: AUDIT_VERSION,
    generatedAt: new Date().toISOString(),
    source: { chars: source.length, lines: sourceMap.lineCount, hash: hashText(source), indexerUsed: false },
    card: { name: options.cardName ?? null, fieldCount: normalized.length, fields: normalized.map((f) => ({ field: f.field, line: f.line, hash: f.hash, chars: f.text.length })) },
    findings: finalFindings,
    stats: { total: finalFindings.length, fixTokens: [...new Set(finalFindings.map((f) => f.fixToken))] },
  };
}

/**
 * Group findings by fixToken — the shape the mutation transaction layer
 * consumes when building a repair plan.
 */
export function groupFindingsByFixToken(findings = []) {
  const groups = new Map();
  for (const finding of findings) {
    if (!groups.has(finding.fixToken)) groups.set(finding.fixToken, []);
    groups.get(finding.fixToken).push(finding);
  }
  return groups;
}

export default {
  AUDIT_VERSION,
  hashText,
  auditCard,
  auditCardFields,
  groupFindingsByFixToken,
  RULES,
  RULE_LABELS,
  FIX_TOKENS,
};

/** Backward-compatibility alias for Alpha 1 test suite. */
export function auditCardAndConstraints(activePrompts = [], cardData = null) {
  const auditRes = auditCard(cardData || {});
  const gagFindings = auditRes.findings.filter(f => f.ruleLabel === 'OOC Gag Trap');
  return {
    hasOocGagRisk: gagFindings.length > 0,
    oocGagRisks: gagFindings.map(f => ({
      source: `Character Card: [${f.field}]`,
      ruleLabel: f.ruleLabel,
      matchedSnippet: f.snippet,
      description: 'Rigid behavioral lock.',
      recommendation: 'Remove from card post-history or isolate during OOC.',
    })),
    negativeConstraintStats: {
      totalNegativeConstraints: auditRes.findings.filter(f => f.ruleLabel === 'Negative Constraint Fatigue').length,
    },
    collisions: [],
  };
}
