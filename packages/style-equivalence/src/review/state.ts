import type { StyleElement } from '../extract';
import type { SignoffRecord } from '../signoff/store';
import { allowedReasons, type Verdict } from '../verdict';
import type { AgentNote, Reviews, ReworkRecord } from './store';

export type ReviewState = 'changed' | 'passed' | 'reworked' | 'todo' | 'waiting-agent';

export const REVIEW_PASS = 'REVIEW_PASS';

const AGENT_FLAGS = new Set([
  'CONTAINER_UNMODELED',
  'GLOBAL_RULES_CHANGED',
  'MEDIA_UNMODELED',
  'PLACEMENT_NEUTRAL_PROP',
  'PLACEMENT_SUBSTITUTED',
  'PSEUDO_UNMODELED',
  'STATE_UNMODELED',
  'STYLESHEET_UNPARSEABLE',
  'STYLESHEET_UNREADABLE',
  'STYLE_OUTSIDE_JSX',
]);

type VerdictEntry = Verdict['items'][number];

export interface ReviewItem extends VerdictEntry {
  canPass: boolean;
  needsAgent: boolean;
  note?: AgentNote;
  rework?: ReworkRecord;
  state: ReviewState;
}

export interface ReviewContext {
  combos: Map<string, number>;
  signatures: Map<string, string>;
}

export const elementSignature = (element: Pick<StyleElement, 'slots' | 'tag'>) =>
  `${element.tag}|${[...element.slots].sort().join(',')}`;

const needsPerson = (item: VerdictEntry) =>
  item.category === 'blocking' || item.signoff !== 'not-needed';

const needsAgent = (item: VerdictEntry, combos: number | undefined) =>
  item.category === 'needs-signoff' &&
  (item.flags.some((flag) => AGENT_FLAGS.has(flag.split(':')[0])) ||
    (item.flags.includes('VARIABLE_UNMODELED') && (combos ?? 1) <= 1));

const canPassItem = (item: VerdictEntry) =>
  item.category !== 'blocking' && !(item.category === 'difference' && !item.flags.length);

const stateOf = (
  item: VerdictEntry,
  agent: boolean,
  rework: ReworkRecord | undefined,
  note: AgentNote | undefined,
  signature: string | undefined,
  pass: SignoffRecord | undefined,
): ReviewState => {
  const passed = item.signoff === 'valid';
  if (rework && (!passed || !pass || rework.at > pass.signedAt))
    return rework.hash === item.hash && (rework.elementSignature || '') === (signature || '')
      ? 'reworked'
      : 'changed';
  if (passed) return 'passed';
  if (agent && note?.hash !== item.hash) return 'waiting-agent';
  return 'todo';
};

export const reviewItems = (
  items: VerdictEntry[],
  reviews: Reviews,
  context: ReviewContext,
): ReviewItem[] =>
  items.filter(needsPerson).map((item) => {
    const agent = needsAgent(item, context.combos.get(item.key));
    const rework = reviews.reworks.get(item.key);
    const openRework = rework && !rework.resolvedAt ? rework : undefined;
    const note = reviews.notes.get(item.key);
    const state = stateOf(
      item,
      agent,
      openRework,
      note,
      context.signatures.get(item.key),
      reviews.passes.get(item.key),
    );
    return {
      ...item,
      canPass: canPassItem(item) && state !== 'waiting-agent',
      needsAgent: agent,
      ...(note?.hash === item.hash ? { note } : {}),
      ...(openRework ? { rework: openRework } : {}),
      state,
    };
  });

export const passRecord = (
  item: ReviewItem,
  note: string,
  reviewer: string,
  now: string,
): SignoffRecord => {
  if (!item.canPass) throw new Error(`CANNOT_PASS:${item.key}`);
  if (item.category === 'difference' && !note.trim()) throw new Error('NOTE_REQUIRED');
  return {
    hash: item.hash,
    key: item.key,
    note: note.trim() || '复查通过',
    reason: REVIEW_PASS,
    reasons: allowedReasons(item).sort(),
    signedAt: now,
    signer: reviewer,
  };
};

export interface ReworkMeta {
  base: string;
  head: string;
  note: string;
  pr?: number;
  reviewer: string;
  runId: string;
  signature: string;
}

export const reworkRecord = (item: ReviewItem, meta: ReworkMeta, now: string): ReworkRecord => {
  if (!meta.note.trim()) throw new Error('NOTE_REQUIRED');
  return {
    at: now,
    base: meta.base,
    elementSignature: meta.signature,
    file: item.file,
    hash: item.hash,
    head: meta.head,
    key: item.key,
    note: meta.note.trim(),
    ...(meta.pr ? { pr: meta.pr } : {}),
    reviewer: meta.reviewer,
    runId: meta.runId,
  };
};

export const resolvedReworks = (items: VerdictEntry[], reviews: Reviews, now: string) => {
  const byKey = new Map(items.map((item) => [item.key, item]));
  return [...reviews.reworks.values()]
    .filter((rework) => !rework.resolvedAt)
    .filter((rework) => {
      const item = byKey.get(rework.key);
      return !item || !needsPerson(item);
    })
    .map((rework) => ({ ...rework, resolvedAt: now }));
};
