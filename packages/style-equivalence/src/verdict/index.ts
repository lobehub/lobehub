import type { ReworkRecord } from '../review/store';
import type { SignoffRecord } from '../signoff/store';
import type { CaseCategory } from './categorize';

export const FALSE_POSITIVE = 'TOOL_FALSE_POSITIVE';
export const UNPAIRED = 'UNPAIRED';

export interface VerdictItem {
  category: CaseCategory | 'unpaired';
  file: string;
  flags: string[];
  hash: string;
  key: string;
}

export type SignoffState = 'missing' | 'not-needed' | 'stale' | 'valid';

export const allowedReasons = (item: VerdictItem) => {
  if (item.category === 'unpaired') return [UNPAIRED];
  if (item.category === 'difference') return item.flags.length ? [FALSE_POSITIVE] : [];
  if (item.category === 'needs-signoff') return item.flags;
  return [];
};

const needsSignoff = (item: VerdictItem) =>
  item.category === 'unpaired' ||
  item.category === 'needs-signoff' ||
  item.category === 'difference';

const coveredReasons = (item: VerdictItem, record: SignoffRecord | undefined) =>
  record && record.hash === item.hash ? (record.reasons ?? [record.reason]) : [];

export const signoffState = (
  item: VerdictItem,
  record: SignoffRecord | undefined,
): SignoffState => {
  if (!needsSignoff(item)) return 'not-needed';
  if (!record) return 'missing';
  if (record.hash !== item.hash) return 'stale';
  const allowed = allowedReasons(item);
  const covered = coveredReasons(item, record);
  if (allowed.length && allowed.every((reason) => covered.includes(reason))) return 'valid';
  return covered.some((reason) => allowed.includes(reason)) ? 'missing' : 'stale';
};

export interface SignRequest {
  existing?: Map<string, SignoffRecord>;
  items: VerdictItem[];
  keys: string[];
  note: string;
  now: string;
  reason: string;
  signer: string;
}

export const signCases = ({ existing, items, keys, note, now, reason, signer }: SignRequest) => {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const selected = keys.map((key) => {
    const item = byKey.get(key);
    if (!item) throw new Error(`UNKNOWN_CASE:${key}`);
    return item;
  });
  if (selected.length > 1 && selected.some((item) => item.category === 'unpaired'))
    throw new Error('UNPAIRED_ONE_BY_ONE');
  for (const item of selected) {
    if (item.category === 'difference' && !item.flags.length)
      throw new Error(`UNFLAGGED_DIFFERENCE:${item.key}`);
    if (!allowedReasons(item).includes(reason))
      throw new Error(`REASON_NOT_ALLOWED:${item.key}:${reason}`);
  }
  if (!note.trim()) throw new Error('NOTE_REQUIRED');
  return selected.map((item): SignoffRecord => ({
    hash: item.hash,
    key: item.key,
    note,
    reason,
    reasons: [...new Set([...coveredReasons(item, existing?.get(item.key)), reason])].sort(),
    signedAt: now,
    signer,
  }));
};

export interface VerdictInput {
  calibration: Array<{ status: string }>;
  items: VerdictItem[];
  mutation: { passed: boolean };
  reworks?: Map<string, ReworkRecord>;
  signoffs: Map<string, SignoffRecord>;
  unparsedSelectors?: number;
}

export interface Verdict {
  items: Array<VerdictItem & { signedReasons: string[]; signoff: SignoffState }>;
  mergeable: boolean;
  reasons: string[];
}

export const decideVerdict = ({
  calibration,
  items,
  mutation,
  reworks,
  signoffs,
  unparsedSelectors,
}: VerdictInput): Verdict => {
  const states = items.map((item) => ({
    ...item,
    signedReasons: coveredReasons(item, signoffs.get(item.key)).filter((reason) =>
      allowedReasons(item).includes(reason),
    ),
    signoff: signoffState(item, signoffs.get(item.key)),
  }));
  const open = (predicate: (item: (typeof states)[number]) => boolean) =>
    states.filter((item) => predicate(item) && item.signoff !== 'valid');
  const reasons: string[] = [];
  const blocking = states.filter((item) => item.category === 'blocking').length;
  if (blocking) reasons.push(`blocking ${blocking}`);
  const differences = open((item) => item.category === 'difference');
  if (differences.length) reasons.push(`difference ${differences.length}`);
  for (const [category, label] of [
    ['needs-signoff', 'needs sign-off'],
    ['unpaired', 'unpaired'],
  ] as const) {
    const unsigned = open((item) => item.category === category);
    if (!unsigned.length) continue;
    const stale = unsigned.filter((item) => item.signoff === 'stale').length;
    reasons.push(`${label} ${unsigned.length}${stale ? ` (${stale} stale)` : ''}`);
  }
  const hashes = new Map(items.map((item) => [item.key, item.hash]));
  const openReworks = [...(reworks?.values() ?? [])].filter(
    (rework) => !rework.resolvedAt && hashes.get(rework.key) === rework.hash,
  ).length;
  if (openReworks) reasons.push(`rework open ${openReworks}`);
  const mismatches = calibration.filter((entry) => entry.status === 'mismatch').length;
  if (mismatches) reasons.push(`calibration mismatch ${mismatches}`);
  if (!mutation.passed) reasons.push('mutation not fully caught');
  if (unparsedSelectors) reasons.push(`selector unparsed ${unparsedSelectors}`);
  return { items: states, mergeable: !reasons.length, reasons };
};
