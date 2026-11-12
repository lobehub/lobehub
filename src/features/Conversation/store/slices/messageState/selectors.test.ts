import { describe, expect, it, vi } from 'vitest';

import type { State } from '../../initialState';
import { messageStateSelectors } from './selectors';

const stateWith = (
  displayMessages: unknown[],
  generatingIds: string[],
  selectedMessageIds: string[] = [],
): State =>
  ({
    displayMessages,
    operationState: {
      getMessageOperationState: (id: string) => ({ isGenerating: generatingIds.includes(id) }),
    },
    selectedMessageIds,
  }) as unknown as State;

const steered = [
  { id: 'u1', role: 'user' },
  { children: [{ id: 'g1' }], id: 'g1', role: 'assistantGroup' },
  { id: 's1', metadata: { steer: true }, role: 'user' },
  { children: [{ id: 'g2' }, { id: 'g2-b' }], id: 'g2', role: 'assistantGroup' },
];

describe('isRowGenerating', () => {
  it('reports the host row generating while a folded continuation streams', () => {
    const state = stateWith(steered, ['g2-b']);

    expect(messageStateSelectors.isMessageGenerating('g1')(state)).toBe(false);
    expect(messageStateSelectors.isRowGenerating('g1')(state)).toBe(true);
  });

  it('sees a plain assistant continuation streaming behind its host', () => {
    const mixed = [
      ...steered,
      { id: 's2', metadata: { steer: true }, role: 'user' },
      { id: 'a3', role: 'assistant' },
    ];

    expect(messageStateSelectors.isRowGenerating('g1')(stateWith(mixed, ['a3']))).toBe(true);
  });

  it('falls back to the message itself for a plain row', () => {
    expect(messageStateSelectors.isRowGenerating('u1')(stateWith(steered, []))).toBe(false);
    expect(messageStateSelectors.isRowGenerating('g1')(stateWith(steered, ['g1']))).toBe(true);
  });
});

describe('isAssistantGroupItemGenerating', () => {
  it('resolves a block to its group without rescanning the message list', () => {
    const state = stateWith(steered, ['g2']);
    const scans = vi.spyOn(state.displayMessages, 'find');

    expect(messageStateSelectors.isAssistantGroupItemGenerating('g2-b')(state)).toBe(true);
    expect(messageStateSelectors.isAssistantGroupItemGenerating('g1')(state)).toBe(false);
    expect(scans).not.toHaveBeenCalled();
  });
});

describe('forwardableSelectedMessages', () => {
  it('expands the host row and drops members without forwardable text', () => {
    const messages = [
      { id: 'u1', role: 'user' },
      { children: [{ content: 'first', id: 'g1' }], id: 'g1', role: 'assistantGroup' },
      { content: 'steer', id: 's1', metadata: { steer: true }, role: 'user' },
      { children: [{ content: '', id: 'g2' }], id: 'g2', role: 'assistantGroup' },
    ];

    expect(
      messageStateSelectors
        .forwardableSelectedMessages(stateWith(messages, [], ['g1']))
        .map((m) => m.id),
    ).toEqual(['g1', 's1']);
  });
});

describe('selectedDeletableMessageIds', () => {
  it('expands selected rows to every member block and tool result without duplicates', () => {
    const messages = [
      { id: 'u1', role: 'user' },
      {
        children: [
          { id: 'g1' },
          { id: 'c2', tools: [{ id: 't1', result: { id: 'tool-result-1' } }] },
        ],
        id: 'g1',
        role: 'assistantGroup',
      },
      { id: 's1', metadata: { steer: true }, role: 'user' },
      { content: 'reply', id: 'a2', role: 'assistant' },
    ];

    expect(
      messageStateSelectors.selectedDeletableMessageIds(stateWith(messages, [], ['u1', 'g1'])),
    ).toEqual(['u1', 'g1', 'c2', 'tool-result-1', 's1', 'a2']);
  });
});

describe('isMessageInterrupted', () => {
  const withRow = (row: Record<string, unknown>, generating = false) =>
    ({
      dbMessages: [{ id: 'a1', role: 'assistant', ...row }],
      operationState: {
        getMessageOperationState: () => ({ isGenerating: generating, isInterrupted: false }),
      },
    }) as unknown as State;

  // ROOT CAUSE:
  //
  // The "interrupted" hint only read the in-session cancelled operation. A run
  // stopped before its first output keeps the `...` placeholder, which renders
  // nothing, so after a reload (or on a late cancel that never opened a socket)
  // the turn showed as an empty bubble with no stopped state.
  //
  // Before: false. After: the server's persisted marker shows it stopped.
  it('reads the persisted marker on a placeholder stopped before its first output', () => {
    const row = { content: '...', metadata: { interruptedMidStream: true } };

    expect(messageStateSelectors.isMessageInterrupted('a1')(withRow(row))).toBe(true);
  });

  it('reads the persisted marker on a turn stopped mid-stream', () => {
    const row = { content: 'Roses are', metadata: { interruptedMidStream: true } };

    expect(messageStateSelectors.isMessageInterrupted('a1')(withRow(row))).toBe(true);
  });

  it('ignores the marker while the row is generating again, and rows without it', () => {
    const row = { content: '...', metadata: { interruptedMidStream: true } };

    expect(messageStateSelectors.isMessageInterrupted('a1')(withRow(row, true))).toBe(false);
    expect(messageStateSelectors.isMessageInterrupted('a1')(withRow({ content: 'done' }))).toBe(
      false,
    );
  });
});
