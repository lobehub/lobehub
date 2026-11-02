// @vitest-environment node
import { type Message, parse } from '@lobechat/conversation-flow';
import { describe, expect, it, vi } from 'vitest';

import type * as WorkRegistrationModule from '@/server/services/workRegistration';

import { CompletionLifecycle } from '.';

vi.mock('@/database/models/work', () => import('./testUtils').then((m) => m.workModelModule()));
vi.mock('@/database/models/topic', () => import('./testUtils').then((m) => m.topicModelModule()));
vi.mock('@/business/server/agent-run/agentInterventionReview', () =>
  import('./testUtils').then((m) => m.agentInterventionReviewModule()),
);
vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () =>
  import('./testUtils').then((m) => m.notifyAgentRunCompletedModule()),
);
vi.mock('../agentInterventionNotification', () =>
  import('./testUtils').then((m) => m.agentInterventionNotificationModule()),
);
vi.mock('@/server/services/workRegistration', async (importOriginal) => ({
  // Keep the real scope resolver: it is pure, and the share-visitor test
  // asserts the scope it derives reaches both the scan and the anchor lookup.
  ...(await importOriginal<typeof WorkRegistrationModule>()),
  registerWorksForOperation: vi.fn(),
}));

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

describe('CompletionLifecycle.buildLifecycleEvent', () => {
  const callBuild = (state: unknown, reason = 'completed') =>
    (buildLifecycle() as any).buildLifecycleEvent('op-1', state, reason);

  it('attaches Markdown images explicitly included in the final reply without changing its text', () => {
    const url = 'https://cdn.example.com/f/file_image';
    const content = `Here is the result: ![Result](${url})`;
    const { event } = callBuild({ messages: [{ role: 'assistant', content }] });
    expect(event.attachments).toEqual([{ fetchUrl: url, type: 'image' }]);
    expect(event.lastAssistantContent).toBe(content);
  });

  it('preserves the order of distinct final-reply images', () => {
    const { event } = callBuild({
      messages: [
        {
          role: 'assistant',
          content:
            '![Before](https://cdn.example.com/before.png) ![After](https://cdn.example.com/after.png)',
        },
      ],
    });
    expect(event.attachments?.map((attachment: any) => attachment.fetchUrl)).toEqual([
      'https://cdn.example.com/before.png',
      'https://cdn.example.com/after.png',
    ]);
  });

  it('parses reference images in final text parts and deduplicates structured images', () => {
    const url = 'https://cdn.example.com/result.png';
    const { event } = callBuild({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: `![one][result] ![two](${url})\n\n[result]: ${url}` },
            { type: 'image_url', image_url: { url } },
          ],
        },
      ],
    });
    expect(event.attachments).toEqual([{ fetchUrl: url, type: 'image' }]);
  });

  it('does not promote tool state, tool Markdown, or an earlier reply to final attachments', () => {
    const url = 'https://cdn.example.com/intermediate.png';
    const { event } = callBuild({
      messages: [
        { role: 'assistant', content: `![earlier](${url})` },
        { role: 'user', content: 'Analyze the result without sending an image.' },
        { role: 'assistant', content: '', tools: [{ id: 'call-image' }] },
        {
          role: 'tool',
          content: `![tool result](${url})`,
          state: { generations: [{ asset: { url, type: 'image' } }] },
        },
        { role: 'assistant', content: 'The composition is balanced.' },
      ],
    });
    expect(event.attachments).toBeUndefined();
  });

  it('does not treat ordinary links, code, escaped syntax or unsafe schemes as images', () => {
    const content = [
      'https://cdn.example.com/plain.png',
      '[download](https://cdn.example.com/download.png)',
      '`![inline](https://cdn.example.com/inline.png)`',
      '```md\n![fenced](https://cdn.example.com/fenced.png)\n```',
      '\\![escaped](https://cdn.example.com/escaped.png)',
      '![unsafe](file:///tmp/image.png)',
      '![unsafe](javascript:alert)',
    ].join('\n\n');
    const { event } = callBuild({ messages: [{ role: 'assistant', content }] });
    expect(event.attachments).toBeUndefined();
  });

  it('extracts text content from a plain-string final assistant turn', () => {
    const state = {
      messages: [
        { content: 'user prompt', role: 'user' },
        { content: 'final answer', role: 'assistant' },
      ],
      origin: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBe('final answer');
    expect(event.attachments).toBeUndefined();
  });

  it('preserves the final answer after DB messages are parsed into an assistantGroup', () => {
    const dbMessages: Message[] = [
      {
        content: 'user prompt',
        createdAt: 0,
        id: 'msg-user',
        role: 'user',
        updatedAt: 0,
      },
      {
        content: '',
        createdAt: 1,
        id: 'msg-tool-call',
        parentId: 'msg-user',
        role: 'assistant',
        tools: [
          {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'builtin',
            result_msg_id: 'msg-tool-result',
            type: 'default',
          },
        ],
        updatedAt: 1,
      },
      {
        content: 'tool result',
        createdAt: 2,
        id: 'msg-tool-result',
        parentId: 'msg-tool-call',
        role: 'tool',
        tool_call_id: 'tool-call-1',
        updatedAt: 2,
      },
      {
        content: 'final answer after tool use',
        createdAt: 3,
        id: 'msg-final',
        parentId: 'msg-tool-result',
        role: 'assistant',
        updatedAt: 3,
      },
    ];
    const { flatList } = parse(dbMessages);

    expect(flatList.at(-1)?.role).toBe('assistantGroup');

    const { assistantMessageId, event } = callBuild({ messages: flatList, metadata: {} });

    expect(assistantMessageId).toBe('msg-final');
    expect(event.lastAssistantContent).toBe('final answer after tool use');
  });

  it('extracts the final assistant leaf from an assistantGroup', () => {
    const state = {
      messages: [
        { content: 'user prompt', id: 'msg-user', role: 'user' },
        {
          children: [
            {
              content: '',
              id: 'msg-tool-call',
              tools: [
                {
                  id: 'tool-call-1',
                  result: { content: 'tool result', id: 'msg-tool-result' },
                },
              ],
            },
            { content: 'grouped final answer', id: 'msg-final' },
          ],
          content: '',
          id: 'msg-group',
          role: 'assistantGroup',
        },
      ],
      origin: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { assistantMessageId, event } = callBuild(state);

    expect(assistantMessageId).toBe('msg-final');
    expect(event.lastAssistantContent).toBe('grouped final answer');
  });

  it('keeps the final empty assistantGroup leaf instead of falling back to stale text', () => {
    const state = {
      messages: [
        { content: 'stale prior answer', id: 'msg-stale', role: 'assistant' },
        { content: 'follow-up prompt', id: 'msg-user', role: 'user' },
        {
          children: [{ content: '', id: 'msg-final' }],
          content: '',
          id: 'msg-group',
          role: 'assistantGroup',
        },
      ],
      metadata: {},
    };

    const { assistantMessageId, event } = callBuild(state);

    expect(assistantMessageId).toBe('msg-final');
    expect(event.lastAssistantContent).toBeUndefined();
  });

  it('treats an empty assistantGroup as the final assistant boundary', () => {
    const state = {
      messages: [
        { content: 'stale prior answer', id: 'msg-stale', role: 'assistant' },
        { children: [], content: '', id: 'msg-empty-group', role: 'assistantGroup' },
      ],
      metadata: {},
    };

    const { assistantMessageId, event } = callBuild(state);

    expect(assistantMessageId).toBe('msg-empty-group');
    expect(event.lastAssistantContent).toBeUndefined();
  });

  it('extracts attachments from grouped assistant and tool-result leaves', () => {
    const state = {
      messages: [
        {
          children: [
            {
              content: '',
              id: 'msg-tool-call',
              tools: [
                {
                  id: 'tool-call-1',
                  result: {
                    content: [
                      {
                        image_url: { url: 'https://cdn.example.com/tool.png' },
                        type: 'image_url',
                      },
                    ],
                    id: 'msg-tool-result',
                  },
                },
              ],
            },
            {
              content: [
                { text: 'done', type: 'text' },
                {
                  image_url: { url: 'https://cdn.example.com/final.png' },
                  type: 'image_url',
                },
              ],
              id: 'msg-final',
            },
          ],
          content: '',
          id: 'msg-group',
          role: 'assistantGroup',
        },
      ],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBe('done');
    expect(event.attachments).toEqual([
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/tool.png', type: 'image' }),
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/final.png', type: 'image' }),
    ]);
  });

  it('concatenates text parts from a multimodal final assistant turn', () => {
    const state = {
      messages: [
        {
          content: [
            { text: 'here is the image: ', type: 'text' },
            { image_url: { url: 'https://cdn.example.com/a.png' }, type: 'image_url' },
            { text: '\n\nhope it helps', type: 'text' },
          ],
          role: 'assistant',
        },
      ],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBe('here is the image: \n\nhope it helps');
    expect(event.attachments).toEqual([
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/a.png', type: 'image' }),
    ]);
  });

  it('returns undefined text for image-only final assistant turn (no fallback to earlier text)', () => {
    // Regression: the previous implementation `.find(m => role === 'assistant' && hasText)`
    // would skip the image-only final turn and walk back to the earlier text
    // turn, shipping stale prose alongside the current image. The fix matches
    // on role only — text must be undefined when the final turn has no text.
    const state = {
      messages: [
        { content: 'stale prior text', role: 'assistant' },
        { content: 'follow-up prompt', role: 'user' },
        {
          content: [{ image_url: { url: 'https://cdn.example.com/new.png' }, type: 'image_url' }],
          role: 'assistant',
        },
      ],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBeUndefined();
    expect(event.attachments).toEqual([
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/new.png', type: 'image' }),
    ]);
  });

  it('returns undefined text when there are no assistant messages', () => {
    const state = {
      messages: [{ content: 'just a user prompt', role: 'user' }],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBeUndefined();
    expect(event.attachments).toBeUndefined();
  });

  it('returns undefined text when content is an empty string', () => {
    // `extractTextFromMessageContent` returns undefined for empty strings, so
    // an empty-string final assistant turn must not pretend it has text.
    const state = {
      messages: [{ content: '', role: 'assistant' }],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBeUndefined();
  });

  it('handles missing messages array gracefully', () => {
    const { event } = callBuild({ origin: { agentId: 'a' } });

    expect(event.lastAssistantContent).toBeUndefined();
    expect(event.attachments).toBeUndefined();
    expect(event.agentId).toBe('a');
  });

  it('preserves safe external-agent context on completion hooks', () => {
    const { event } = callBuild(
      {
        error: {
          type: 'AgentRuntimeError',
          body: {
            agentType: 'claude-code',
            code: 'rate_limit',
            details: { kind: 'usage_limit' },
            stderr: 'secret path',
            rateLimitInfo: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1789826400 },
          },
        },
        origin: { agentId: 'agent-1', userId: 'user-1' },
      },
      'error',
    );
    expect(event.errorAttribution).toBe('user');
    expect(event.errorHeterogeneous).toEqual({
      agentType: 'claude-code',
      kind: 'usage_limit',
      rateLimitType: 'seven_day',
      resetsAt: 1789826400,
    });
  });

  it('carries the allowlisted cause of a failed sandbox dispatch', () => {
    const { event } = callBuild(
      {
        error: {
          body: {
            dispatch: {
              agentType: 'claude-code',
              deviceAccessDenied: true,
              missingCredential: 'CLAUDE_CODE_OAUTH_TOKEN',
              stage: 'sandbox_spawn',
            },
          },
          message: 'Hetero sandbox spawn failed',
          type: 'ServerAgentRuntimeError',
        },
        origin: { agentId: 'agent-1', userId: 'user-1' },
      },
      'error',
    );

    expect(event.errorDispatch).toEqual({
      agentType: 'claude-code',
      deviceAccessDenied: true,
      missingCredential: 'CLAUDE_CODE_OAUTH_TOKEN',
      stage: 'sandbox_spawn',
    });
  });

  it('populates errorType + attribution from the normalized error on the error path', () => {
    // Regression: the event previously carried only errorDetail/errorMessage, so
    // bot reply renderers never saw the stable code/attribution and always fell
    // back to the opaque Operation ID. buildLifecycleEvent must normalize the
    // runtime error via formatErrorForState and surface these taxonomy fields.
    const state = {
      error: { error: { message: 'fetch failed' }, errorType: 'ProviderNetworkError' },
      origin: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { event } = callBuild(state, 'error');

    expect(event.errorType).toBe('ProviderNetworkError');
    expect(event.errorAttribution).toBe('system');
    expect(event.errorMessage).toBe('fetch failed');
  });

  it('carries the budget context of an exhausted allowance onto the event', () => {
    // Without this the bot reply can only say "not enough credits": which
    // allowance ran out, and by how much, lived in the error body and stopped
    // at the lifecycle boundary.
    const state = {
      error: {
        budget: {
          availableCredits: 7_242_747,
          budgetTypeAtError: 'workspace_member',
          requiredCredits: 197_391,
          shortfallCredits: 0,
        },
        error: { message: 'Workspace budget exceeded' },
        errorType: 'InsufficientBudgetForModel',
      },
      origin: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { event } = callBuild(state, 'error');

    expect(event.errorBudget).toEqual({
      availableCredits: 7_242_747,
      budgetTypeAtError: 'workspace_member',
      requiredCredits: 197_391,
      shortfallCredits: 0,
    });
  });

  it('leaves errorType + attribution undefined when there is no error', () => {
    const { event } = callBuild({ messages: [], metadata: {} }, 'done');

    expect(event.errorType).toBeUndefined();
    expect(event.errorAttribution).toBeUndefined();
  });

  it('resolves assistantMessageId from the final assistant message row when metadata omits it', () => {
    // Regression: a server execAgent turn carries operation-level metadata
    // ({} in DB) with no assistantMessageId, so the completion event previously
    // shipped assistantMessageId=undefined and the deferred skill-synthesis
    // handler no-oped. The id must fall back to the persisted id on the final
    // assistant message row in state (deferred skill synthesis needs the
    // anchor to seed the skill under the assistant group, not under the user
    // message).
    const state = {
      messages: [
        { content: 'user prompt', id: 'msg-user', role: 'user' },
        { content: 'tool result', id: 'msg-tool', role: 'tool' },
        { content: 'final answer', id: 'msg-assistant', role: 'assistant' },
        { content: 'trailing tool result', id: 'msg-tool-2', role: 'tool' },
      ],
      origin: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { assistantMessageId } = callBuild(state, 'done');

    expect(assistantMessageId).toBe('msg-assistant');
  });

  it('prefers metadata.assistantMessageId over the state row (client runtime path)', () => {
    // The client runtime path supplies assistantMessageId on operation metadata;
    // it must win over the state-row fallback so the anchor stays the id the
    // client already persisted the parked candidate against.
    const state = {
      messages: [{ content: 'final answer', id: 'msg-from-state', role: 'assistant' }],
      metadata: { assistantMessageId: 'msg-from-metadata' },
      origin: { agentId: 'agent-1' },
    };

    const { assistantMessageId } = callBuild(state, 'done');

    expect(assistantMessageId).toBe('msg-from-metadata');
  });

  it('leaves assistantMessageId undefined when neither metadata nor a state row carries it', () => {
    const { assistantMessageId } = callBuild(
      { messages: [{ content: 'just a user prompt', role: 'user' }], metadata: {} },
      'done',
    );

    expect(assistantMessageId).toBeUndefined();
  });
});
