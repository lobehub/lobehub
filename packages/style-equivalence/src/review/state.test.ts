import { describe, expect, it } from 'vitest';

import { decideVerdict, type VerdictItem } from '../verdict';
import {
  agentPassRecord,
  asksAgentNote,
  passRecord,
  resolvedReworks,
  reviewItems,
  reworkRecord,
} from './state';
import type { Reviews, ReworkRecord } from './store';

const item = (overrides: Partial<VerdictItem> = {}): VerdictItem => ({
  category: 'needs-signoff',
  file: 'src/A.tsx',
  flags: ['VARIABLE_UNMODELED'],
  hash: 'h1',
  key: 'src/A.tsx|A#0',
  ...overrides,
});

const empty = (): Reviews => ({ notes: new Map(), passes: new Map(), reworks: new Map() });

const verdictOf = (items: VerdictItem[], reviews: Reviews) =>
  decideVerdict({
    calibration: [],
    items,
    mutation: { passed: true },
    reworks: reviews.reworks,
    signoffs: reviews.passes,
  });

const context = (combos = 2, signature = 'span|styles.dot') => ({
  combos: new Map([['src/A.tsx|A#0', combos]]),
  signatures: new Map([['src/A.tsx|A#0', signature]]),
});

const rework = (hash = 'h1', signature = 'span|styles.dot'): ReworkRecord => ({
  at: 'now',
  base: 'b',
  elementSignature: signature,
  file: 'src/A.tsx',
  hash,
  head: 'h',
  key: 'src/A.tsx|A#0',
  note: '在线时多了灰边',
  reviewer: 'innei',
  runId: 'r1',
});

const stateOf = (items: VerdictItem[], reviews: Reviews, ctx = context()) =>
  reviewItems(verdictOf(items, reviews).items, reviews, ctx)[0]?.state;

describe('review state', () => {
  it('moves from todo to reworked, to changed when the source changes, to passed', () => {
    const reviews = empty();
    expect(stateOf([item()], reviews)).toBe('todo');
    reviews.reworks.set('src/A.tsx|A#0', rework());
    expect(stateOf([item()], reviews)).toBe('reworked');
    expect(stateOf([item({ hash: 'h2' })], reviews)).toBe('changed');
    const [changed] = reviewItems(
      verdictOf([item({ hash: 'h2' })], reviews).items,
      reviews,
      context(),
    );
    reviews.passes.set(changed.key, passRecord(changed, '', 'innei', 'now'));
    expect(stateOf([item({ hash: 'h2' })], reviews)).toBe('passed');
  });

  it('shows a send-back made after a pass as reworked', () => {
    const reviews = empty();
    const [entry] = reviewItems(verdictOf([item()], reviews).items, reviews, context());
    reviews.passes.set(entry.key, passRecord(entry, '', 'innei', '2026-11-05T01:00:00Z'));
    reviews.reworks.set(entry.key, { ...rework(), at: '2026-11-05T02:00:00Z' });
    expect(stateOf([item()], reviews)).toBe('reworked');
  });

  it('keeps a file-level send-back as reworked when neither side has an element signature', () => {
    const reviews = empty();
    const fileItem = item({ flags: ['STYLE_OUTSIDE_JSX'], key: 'src/A.tsx|file' });
    reviews.reworks.set(fileItem.key, { ...rework(), elementSignature: '', key: fileItem.key });
    const ctx = { combos: new Map<string, number>(), signatures: new Map<string, string>() };
    expect(reviewItems(verdictOf([fileItem], reviews).items, reviews, ctx)[0].state).toBe(
      'reworked',
    );
  });

  it('marks a rework changed when the element at that key is a different element', () => {
    const reviews = empty();
    reviews.reworks.set('src/A.tsx|A#0', rework('h1', 'div|styles.card'));
    expect(stateOf([item()], reviews)).toBe('changed');
  });

  it('one pass covers every flag of the item', () => {
    const reviews = empty();
    const [entry] = reviewItems(
      verdictOf([item({ flags: ['VARIABLE_UNMODELED', 'CROSS_COMPONENT'] })], reviews).items,
      reviews,
      context(),
    );
    const record = passRecord(entry, '', 'innei', 'now');
    expect(record.reasons).toEqual(['CROSS_COMPONENT', 'VARIABLE_UNMODELED']);
    expect(record.note).toBe('复查通过');
    reviews.passes.set(record.key, record);
    expect(
      verdictOf([item({ flags: ['VARIABLE_UNMODELED', 'CROSS_COMPONENT'] })], reviews).mergeable,
    ).toBe(true);
  });

  it('never lets a difference without flags pass', () => {
    const reviews = empty();
    const [entry] = reviewItems(
      verdictOf([item({ category: 'difference', flags: [] })], reviews).items,
      reviews,
      context(),
    );
    expect(entry.canPass).toBe(false);
    expect(() => passRecord(entry, '看过了', 'innei', 'now')).toThrow('CANNOT_PASS');
  });

  it('requires a note to pass a flagged difference', () => {
    const reviews = empty();
    const [entry] = reviewItems(
      verdictOf([item({ category: 'difference', flags: ['CROSS_COMPONENT'] })], reviews).items,
      reviews,
      context(),
    );
    expect(() => passRecord(entry, ' ', 'innei', 'now')).toThrow('NOTE_REQUIRED');
    expect(passRecord(entry, '工具误报', 'innei', 'now').reasons).toEqual(['TOOL_FALSE_POSITIVE']);
  });

  it('blocks the merge while a rework is open', () => {
    const reviews = empty();
    const [entry] = reviewItems(verdictOf([item()], reviews).items, reviews, context());
    reviews.passes.set(entry.key, passRecord(entry, '', 'innei', 'now'));
    reviews.reworks.set(entry.key, rework());
    expect(verdictOf([item()], reviews).reasons).toContain('rework open 1');
  });

  it('requires a note for a rework', () => {
    const [entry] = reviewItems(verdictOf([item()], empty()).items, empty(), context());
    const meta = { base: 'b', head: 'h', reviewer: 'innei', runId: 'r1', signature: 's' };
    expect(() => reworkRecord(entry, { ...meta, note: '' }, 'now')).toThrow('NOTE_REQUIRED');
    expect(reworkRecord(entry, { ...meta, note: '灰边' }, 'now').elementSignature).toBe('s');
  });

  it('waits for the agent on items with nothing to observe until a current note exists', () => {
    const reviews = empty();
    const placement = item({ flags: ['PLACEMENT_SUBSTITUTED'] });
    expect(stateOf([placement], reviews)).toBe('waiting-agent');
    expect(stateOf([item()], reviews, context(1))).toBe('waiting-agent');
    reviews.notes.set(placement.key, {
      at: 'now',
      finding: 'f',
      hash: 'old',
      key: placement.key,
      suggestion: 'pass',
    });
    expect(stateOf([placement], reviews)).toBe('waiting-agent');
    reviews.notes.set(placement.key, {
      at: 'now',
      finding: 'f',
      hash: 'h1',
      key: placement.key,
      suggestion: 'pass',
    });
    expect(stateOf([placement], reviews)).toBe('todo');
  });

  it('lists blocking items with only the rework action', () => {
    const [entry] = reviewItems(
      verdictOf([item({ category: 'blocking', flags: [] })], empty()).items,
      empty(),
      context(),
    );
    expect(entry).toMatchObject({ canPass: false, state: 'todo' });
  });

  it('resolves a rework whose item no longer needs a person', () => {
    const reviews = empty();
    reviews.reworks.set('src/A.tsx|A#0', rework());
    const resolved = resolvedReworks(
      verdictOf([item({ category: 'equal', flags: [] })], reviews).items,
      reviews,
      'now',
    );
    expect(resolved).toMatchObject([{ key: 'src/A.tsx|A#0', resolvedAt: 'now' }]);
  });
});

describe('agentPassRecord', () => {
  const reviewed = (items: VerdictItem[], reviews = empty()) =>
    reviewItems(verdictOf(items, reviews).items, reviews, context())[0];

  it('signs an item the tool rendered equal once the agent confirms the uncovered part', () => {
    const record = agentPassRecord(reviewed([item()]), '两边一致', 'now');
    const reviews = empty();
    reviews.passes.set(record!.key, record!);

    expect(record).toMatchObject({ hash: 'h1', note: '两边一致', signer: 'agent' });
    expect(stateOf([item()], reviews)).toBe('passed');
  });

  it('signs an item that was waiting for the agent note', () => {
    const waiting = reviewed([item({ flags: ['STATE_UNMODELED'] })]);
    expect(waiting.state).toBe('waiting-agent');
    expect(agentPassRecord(waiting, '两边一致', 'now')).toMatchObject({ signer: 'agent' });
  });

  it('leaves rendered differences and one-sided elements to a person', () => {
    expect(
      agentPassRecord(reviewed([item({ category: 'difference' })]), '两边一致', 'now'),
    ).toBeUndefined();
    expect(
      agentPassRecord(
        reviewed([item({ category: 'unpaired', flags: ['UNPAIRED'] })]),
        '两边一致',
        'now',
      ),
    ).toBeUndefined();
  });

  it('does not override a send-back from a person', () => {
    const reviews = empty();
    reviews.reworks.set('src/A.tsx|A#0', rework());
    expect(agentPassRecord(reviewed([item()], reviews), '两边一致', 'now')).toBeUndefined();
  });
});

describe('asksAgentNote', () => {
  it('asks the agent about every rendered-equal item still waiting for a person', () => {
    expect(asksAgentNote({ category: 'needs-signoff', state: 'todo' })).toBe(true);
    expect(asksAgentNote({ category: 'needs-signoff', state: 'waiting-agent' })).toBe(true);
  });

  it('leaves differences, one-sided elements and decided items alone', () => {
    expect(asksAgentNote({ category: 'difference', state: 'todo' })).toBe(false);
    expect(asksAgentNote({ category: 'unpaired', state: 'todo' })).toBe(false);
    expect(asksAgentNote({ category: 'needs-signoff', state: 'passed' })).toBe(false);
    expect(asksAgentNote({ category: 'needs-signoff', state: 'reworked' })).toBe(false);
  });
});
