import { describe, expect, it } from 'vitest';

import type { TopicPreview } from '@/services/message/topicPreview';

import {
  groupAnswerProps,
  resolvePreviewLayout,
  resolvePreviewProcess,
  resolveWholeTopicLeading,
} from './layout';

const preview = (overrides: Partial<TopicPreview> = {}): TopicPreview =>
  ({
    editedFiles: [],
    goals: [],
    kind: 'group',
    message: { content: 'the final answer', id: 'msg_final', role: 'assistant' },
    status: 'ok',
    topicId: 'tpc_a',
    topicUpdatedAt: '2026-10-27T00:00:00.000Z',
    workRootOperationId: null,
    works: [],
    blocks: [],
    leading: null,
    timeline: [],
    ...overrides,
  }) as TopicPreview;

describe('groupAnswerProps', () => {
  it('hands the answer text to the group block, which otherwise reads an empty store', () => {
    const props = groupAnswerProps(preview().message);

    expect(props.contentOverride).toBe('the final answer');
    expect(props.hasToolsOverride).toBe(false);
    expect(props.domId).toBe('msg_final__answer');
  });
});

describe('resolvePreviewLayout', () => {
  it('leaves the model line to the action row for a group answer', () => {
    expect(resolvePreviewLayout(preview()).showModelLine).toBe(false);
  });

  it('shows the model line under a single reply', () => {
    expect(resolvePreviewLayout(preview({ kind: 'single' })).showModelLine).toBe(true);
  });

  it("reserves the round's cards below a group answer", () => {
    const layout = resolvePreviewLayout(
      preview({
        editedFiles: [{ path: '/a.ts' }] as TopicPreview['editedFiles'],
        goals: [{ goalId: 'goal_1' }] as TopicPreview['goals'],
        workRootOperationId: 'op_1',
        works: [{ id: 'work_1' }] as TopicPreview['works'],
      }),
    );

    expect(layout.cardsBelow).toEqual({
      editedFiles: [{ path: '/a.ts' }],
      goals: [{ goalId: 'goal_1' }],
      works: [{ id: 'work_1' }],
    });
    expect(layout.worksAfterActions).toBeUndefined();
  });

  it('keeps works off a group answer whose round has no work root', () => {
    const layout = resolvePreviewLayout(
      preview({ works: [{ id: 'work_1' }] as TopicPreview['works'] }),
    );

    expect(layout.cardsBelow).toBeUndefined();
  });

  it('puts a single reply works after the action row', () => {
    const layout = resolvePreviewLayout(
      preview({
        kind: 'single',
        message: {
          content: 'answer',
          id: 'msg_final',
          metadata: { work: { rootOperationId: 'op_1' } },
          role: 'assistant',
        } as TopicPreview['message'],
        works: [{ id: 'work_1' }] as TopicPreview['works'],
      }),
    );

    expect(layout.worksAfterActions).toEqual([{ id: 'work_1' }]);
    expect(layout.cardsBelow).toBeUndefined();
  });
});

describe('resolvePreviewProcess', () => {
  const toolBlock = {
    content: '',
    id: 'msg_call',
    tools: [
      {
        apiName: 'search',
        arguments: '{}',
        id: 'call_1',
        identifier: 'lobe-web-browsing',
        result_msg_id: 'msg_result',
        type: 'builtin',
      },
    ],
  };
  const answerBlock = { content: 'the final answer', id: 'msg_final' };
  const timeline = [
    {
      createdAt: '2026-10-27T00:00:00.000Z',
      id: 'msg_call',
      updatedAt: '2026-10-27T00:00:00.000Z',
    },
    {
      createdAt: '2026-10-27T00:00:01.000Z',
      id: 'msg_result',
      updatedAt: '2026-10-27T00:00:04.000Z',
    },
    {
      createdAt: '2026-10-27T00:00:12.000Z',
      id: 'msg_final',
      updatedAt: '2026-10-27T00:00:12.000Z',
    },
  ];

  it('folds a finished tool round the way the list header does', () => {
    const process = resolvePreviewProcess(
      preview({ blocks: [toolBlock, answerBlock] as TopicPreview['blocks'], timeline }),
    );

    expect(process).toEqual({ durationMs: 12_000, stepCount: 2 });
  });

  it('has no process header for a plain reply', () => {
    expect(resolvePreviewProcess(preview({ kind: 'single' }))).toBeUndefined();
  });

  it('has no process header when the round made no tool calls', () => {
    expect(
      resolvePreviewProcess(preview({ blocks: [answerBlock] as TopicPreview['blocks'], timeline })),
    ).toBeUndefined();
  });
});

describe('resolveWholeTopicLeading', () => {
  const question = { content: 'question', id: 'msg_q', role: 'user' };

  it('draws the question when the round is the whole topic', () => {
    const leading = [question] as TopicPreview['leading'];

    expect(resolveWholeTopicLeading(preview({ leading }))).toBe(leading);
  });

  it('keeps the history skeleton when earlier rounds exist', () => {
    expect(resolveWholeTopicLeading(preview({ leading: null }))).toBeUndefined();
  });

  it('keeps the history skeleton for a row it cannot draw like the list', () => {
    const fromBot = { ...question, metadata: { botSender: { name: 'Bot' } } };

    expect(
      resolveWholeTopicLeading(preview({ leading: [fromBot] as TopicPreview['leading'] })),
    ).toBeUndefined();
  });
});
