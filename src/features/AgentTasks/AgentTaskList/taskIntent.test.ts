import type { TaskIntentAnalysis } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  appendParagraphsToEditorJson,
  buildConfirmedDraft,
  buildGoalSeed,
  preserveOriginalInstruction,
  shouldConfirmIntent,
} from './taskIntent';

const analysis = (patch: Partial<TaskIntentAnalysis> = {}): TaskIntentAnalysis => ({
  clarifications: [],
  confidence: 'high',
  kind: 'task',
  refinedInstruction: 'Fix the typo in the README title.',
  summary: 'Fix a typo.',
  title: 'Fix README typo',
  ...patch,
});

describe('shouldConfirmIntent', () => {
  it('lets an unambiguous single-delivery request through', () => {
    expect(shouldConfirmIntent(analysis())).toBe(false);
  });

  it('stops for a question, a goal, or a reading the model is unsure of', () => {
    expect(shouldConfirmIntent(analysis({ clarifications: [{ question: 'Which repo?' }] }))).toBe(
      true,
    );
    expect(shouldConfirmIntent(analysis({ kind: 'goal' }))).toBe(true);
    expect(shouldConfirmIntent(analysis({ confidence: 'medium' }))).toBe(true);
  });
});

describe('preserveOriginalInstruction', () => {
  it('keeps the user text when the brief expands on it', () => {
    expect(preserveOriginalInstruction('ship v1', 'Ship v1 of the CLI, tagged and released.')).toBe(
      'ship v1\n\nShip v1 of the CLI, tagged and released.',
    );
  });

  it('does not duplicate text the brief already quotes', () => {
    expect(preserveOriginalInstruction('ship v1', 'Do this: ship v1 — tagged.')).toBe(
      'Do this: ship v1 — tagged.',
    );
  });

  it('falls back to the original when the brief is empty or identical', () => {
    expect(preserveOriginalInstruction('ship v1', '   ')).toBe('ship v1');
    expect(preserveOriginalInstruction(' ship v1 ', 'ship v1')).toBe('ship v1');
  });
});

const lexicalDoc = (children: unknown[]) => ({ root: { children, type: 'root' } });

const paragraphOf = (text: string) => ({
  children: [{ text, type: 'text' }],
  type: 'paragraph',
});

const fileAttachmentDoc = lexicalDoc([
  paragraphOf('fix the readme typo'),
  { fileUrl: 'https://cdn/spec.pdf', status: 'uploaded', type: 'file' },
]);

const textOf = (json: unknown) =>
  ((json as any).root.children as any[]).flatMap((node) =>
    (node.children ?? []).map((child: any) => child.text),
  );

describe('appendParagraphsToEditorJson', () => {
  it('extends the document without touching what is already in it', () => {
    const result = appendParagraphsToEditorJson(fileAttachmentDoc, ['## Clarifications']);

    expect((result as any).root.children).toHaveLength(3);
    // The file node is exactly the thing a markdown round-trip would drop.
    expect((result as any).root.children[1]).toBe(fileAttachmentDoc.root.children[1]);
    expect(fileAttachmentDoc.root.children).toHaveLength(2);
  });

  it('reports no usable mirror rather than returning one missing the lines', () => {
    // editorData wins over the markdown when a task is rendered, so a stale
    // mirror would show the user a brief the agent never received.
    expect(appendParagraphsToEditorJson({}, ['line'])).toBeUndefined();
    expect(appendParagraphsToEditorJson(undefined, ['line'])).toBeUndefined();
  });

  it('passes the document straight through when there is nothing to add', () => {
    expect(appendParagraphsToEditorJson({}, [])).toEqual({});
  });
});

describe('buildConfirmedDraft', () => {
  const withQuestions = analysis({
    clarifications: [{ question: 'Which repo?' }, { question: 'By when?' }],
  });

  it('appends only the answered questions, to the markdown and the mirror alike', () => {
    const reviewed = lexicalDoc([paragraphOf('fix the readme typo')]);
    const result = buildConfirmedDraft({
      analysis: withQuestions,
      answers: { 0: 'lobehub/lobe-chat', 1: '   ' },
      editorJson: reviewed,
      heading: 'Clarifications',
      instruction: 'fix the readme typo',
    });

    expect(result.instruction).toBe(
      'fix the readme typo\n\n## Clarifications\n- Which repo? lobehub/lobe-chat',
    );
    expect(result.instruction).not.toContain('By when?');
    expect(textOf(result.editorData)).toEqual([
      'fix the readme typo',
      '## Clarifications',
      '- Which repo? lobehub/lobe-chat',
    ]);
  });

  it('creates exactly what the user reviewed when every question was skipped', () => {
    const reviewed = lexicalDoc([paragraphOf('fix the readme typo')]);
    const result = buildConfirmedDraft({
      analysis: withQuestions,
      answers: {},
      editorJson: reviewed,
      heading: 'Clarifications',
      instruction: 'edited by hand',
    });

    expect(result.instruction).toBe('edited by hand');
    expect(result.editorData).toBe(reviewed);
  });
});

describe('buildGoalSeed', () => {
  it('carries the answers already given into the goal handoff', () => {
    const seed = buildGoalSeed({
      analysis: analysis({
        clarifications: [{ question: 'Which metric?' }],
        kind: 'goal',
        refinedInstruction: 'Keep the p95 latency under the agreed bar.',
        title: 'Hold p95 latency',
      }),
      answers: { 0: 'p95 API latency' },
      heading: 'Clarifications',
      instruction: 'keep latency low',
    });

    expect(seed.title).toBe('Hold p95 latency');
    // The instruction handed over is the one the user reviewed, not the draft.
    expect(seed.requirement).toBe(
      'keep latency low\n\n## Clarifications\n- Which metric? p95 API latency',
    );
  });
});
