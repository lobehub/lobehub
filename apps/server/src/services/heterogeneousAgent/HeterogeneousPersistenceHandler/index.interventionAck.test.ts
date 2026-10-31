// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness, ingest } from './eventBranchesTestUtils';

const { acknowledgeAgentInterventionProducerResolution, notifyAgentInterventionRequired } =
  vi.hoisted(() => ({
    acknowledgeAgentInterventionProducerResolution: vi.fn(),
    notifyAgentInterventionRequired: vi.fn(),
  }));
vi.mock('@/business/server/agent-run/agentInterventionReview', () => ({
  acknowledgeAgentInterventionProducerResolution,
  notifyAgentInterventionRequired,
}));

describe('HeterogeneousPersistenceHandler — event branch coverage', () => {
  beforeEach(() => {
    __resetOperationStatesForTesting();
    acknowledgeAgentInterventionProducerResolution.mockReset();
    notifyAgentInterventionRequired.mockReset();
  });
  afterEach(() => __resetOperationStatesForTesting());

  describe('agent_intervention producer ACK', () => {
    it.each(['answer', 'tool_result'])(
      'keeps subagent question ownership through a cold request and %s',
      async (outcome) => {
        const h = createHarness({ topicAgentId: 'agent-test' });
        const args = JSON.stringify({
          questions: [
            { header: 'Scope', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] },
          ],
        });
        const child = { parentToolCallId: 'task-parent', subagentMessageId: 'child-turn' };
        await ingest(h, [
          buildEvent('stream_chunk', 0, {
            chunkType: 'tools_calling',
            subagent: child,
            toolsCalling: [
              {
                apiName: 'askUserQuestion',
                arguments: args,
                id: 'child-question',
                identifier: 'claude-code',
                type: 'default',
              },
            ],
          }),
        ]);
        const toolRow = [...h.messages.values()].find((m) => m.tool_call_id === 'child-question')!;
        expect(toolRow.threadId).toBeTruthy();
        h.messageModel.listMessagePluginsByTopic.mockImplementation(
          async () =>
            [...h.messages.values()]
              .filter((m) => m.role === 'tool')
              .map((m) => ({
                ...m.plugin,
                id: m.id,
                state: m.pluginState,
                toolCallId: m.tool_call_id,
              })) as never[],
        );
        __resetOperationStatesForTesting();
        await ingest(h, [
          buildEvent('agent_intervention_request', 1, {
            apiName: 'askUserQuestion',
            arguments: args,
            deadline: 1_900_000_000_000,
            identifier: 'claude-code',
            interactionKind: 'question',
            provider: 'claude-code',
            toolCallId: 'child-question',
          }),
        ]);
        expect(
          [...h.messages.values()].filter((m) => m.tool_call_id === 'child-question'),
        ).toHaveLength(1);
        expect(notifyAgentInterventionRequired).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              assistantMessageId: toolRow.parentId,
              scope: 'thread',
              threadId: toolRow.threadId,
            }),
          }),
        );
        await ingest(h, [
          buildEvent(outcome === 'answer' ? 'agent_intervention_response' : 'tool_result', 2, {
            ...(outcome === 'answer'
              ? { producerAck: true, result: { 'Proceed?': 'Yes' } }
              : { content: 'done', subagent: child }),
            toolCallId: 'child-question',
          }),
        ]);
        expect(h.messages.get(toolRow.id)?.plugin?.intervention.status).toBe(
          outcome === 'answer' ? 'approved' : 'aborted',
        );
        expect(h.messages.get(toolRow.id)?.threadId).toBe(toolRow.threadId);
      },
    );

    const materializeAskUserTool = async (
      h: ReturnType<typeof createHarness>,
      toolCallId: string,
    ) =>
      ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'tools_calling',
          toolsCalling: [
            {
              apiName: 'askUserQuestion',
              arguments: '{}',
              id: toolCallId,
              identifier: 'claude-code',
              type: 'default',
            },
          ],
        }),
      ]);

    const missingProviderRequest = (toolCallId: string) =>
      buildEvent('agent_intervention_request', 1, {
        apiName: 'askUserQuestion',
        arguments: JSON.stringify({
          questions: [
            {
              header: 'Question',
              options: [{ label: 'Continue' }, { label: 'Stop' }],
              question: 'Proceed?',
            },
          ],
        }),
        deadline: 1_900_000_000_000,
        identifier: 'claude-code',
        interactionKind: 'question',
        toolCallId,
      });

    it.each(['tool_result', 'agent_runtime_end', 'error', 'finish'])(
      'persists automatic closure on %s even after a cold replica reload',
      async (type) => {
        const h = createHarness({ topicAgentId: 'agent-test' });
        const request = missingProviderRequest('ended-question');
        request.data.provider = 'claude-code';
        await ingest(h, [request]);
        const question = [...h.messages.values()].find((m) => m.tool_call_id === 'ended-question')!;
        h.messages.set('other-operation-question', {
          ...question,
          id: 'other-operation-question',
          tool_call_id: 'other-question',
          plugin: {
            ...question.plugin,
            intervention: { status: 'pending', operationId: 'other-op' },
          },
        });
        h.messageModel.listMessagePluginsByTopic.mockImplementation(
          async () =>
            [...h.messages.values()]
              .filter((m) => m.role === 'tool')
              .map((m) => ({
                ...m.plugin,
                id: m.id,
                state: m.pluginState,
                toolCallId: m.tool_call_id,
              })) as never[],
        );
        __resetOperationStatesForTesting();

        if (type === 'finish') {
          await h.handler.finish({
            operationId: h.operationId,
            topicId: h.topicId,
            result: 'success',
          });
        } else {
          await ingest(h, [buildEvent(type, 2, { content: 'done', toolCallId: 'ended-question' })]);
        }

        const row = [...h.messages.values()].find((m) => m.tool_call_id === 'ended-question');
        expect(row?.plugin?.intervention).toMatchObject({ status: 'aborted', resolving: false });
        expect(row?.pluginState?.heterogeneousIntervention.transition).toBe('session_ended');
        expect(h.messages.get('other-operation-question')?.plugin?.intervention.status).toBe(
          'pending',
        );
        expect(acknowledgeAgentInterventionProducerResolution).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'session_ended', toolCallId: 'ended-question' }),
        );
        __resetOperationStatesForTesting();
        await ingest(h, [{ ...request, timestamp: request.timestamp + 1 }]);
        const restored = [...h.messages.values()].find((m) => m.tool_call_id === 'ended-question');
        expect(restored?.plugin?.intervention.status).toBe('aborted');
        expect(notifyAgentInterventionRequired).toHaveBeenCalledTimes(1);
      },
    );

    it('rejects an invalid first Cloud review before any intervention side effect', async () => {
      const h = createHarness({ topicAgentId: 'agent-test' });
      const toolCallId = 'invalid-cloud-question';
      await materializeAskUserTool(h, toolCallId);
      h.messageModel.updateMessagePlugin.mockClear();
      h.messageModel.updatePluginState.mockClear();

      await expect(ingest(h, [missingProviderRequest(toolCallId)])).rejects.toThrow(
        `Unsafe heterogeneous intervention review payload toolCallId=${toolCallId}`,
      );

      expect(h.messageModel.updateMessagePlugin).not.toHaveBeenCalled();
      expect(h.messageModel.updatePluginState).not.toHaveBeenCalled();
      expect(notifyAgentInterventionRequired).not.toHaveBeenCalled();
      expect(acknowledgeAgentInterventionProducerResolution).not.toHaveBeenCalled();
      const toolMessage = [...h.messages.values()].find(
        (message) => message.tool_call_id === toolCallId,
      );
      expect(toolMessage?.plugin).not.toHaveProperty('intervention');
      expect(toolMessage?.pluginState).toBeUndefined();
    });

    it('preserves legacy intervention persistence without a userId', async () => {
      const h = createHarness({ topicAgentId: 'agent-test', userId: null });
      const toolCallId = 'legacy-question';
      await materializeAskUserTool(h, toolCallId);
      h.messageModel.updateMessagePlugin.mockClear();
      h.messageModel.updatePluginState.mockClear();

      await expect(ingest(h, [missingProviderRequest(toolCallId)])).resolves.toBeUndefined();

      expect(h.messageModel.updateMessagePlugin).toHaveBeenCalledTimes(1);
      expect(h.messageModel.updatePluginState).toHaveBeenCalledTimes(1);
      expect(notifyAgentInterventionRequired).not.toHaveBeenCalled();
      expect(acknowledgeAgentInterventionProducerResolution).not.toHaveBeenCalled();
      const toolMessage = [...h.messages.values()].find(
        (message) => message.tool_call_id === toolCallId,
      );
      expect(toolMessage?.plugin?.intervention).toEqual({ status: 'pending' });
      expect(toolMessage?.pluginState?.heterogeneousIntervention).toMatchObject({
        transition: 'pending',
      });
    });

    it.each(['claude-code', 'opencode'] as const)(
      'canonicalizes an omitted %s multiSelect before durable review notification',
      async (provider) => {
        const h = createHarness({ topicAgentId: 'agent-test' });

        await ingest(h, [
          buildEvent('agent_intervention_request', 0, {
            apiName: 'askUserQuestion',
            arguments: JSON.stringify({
              questions: [
                {
                  header: 'Producer ACK E2E',
                  options: [
                    { description: 'Proceed with validation.', label: 'Continue' },
                    { description: 'Halt validation.', label: 'Stop' },
                  ],
                  question: 'Continue read only validation?',
                },
              ],
            }),
            deadline: 1_900_000_000_000,
            identifier: 'claude-code',
            interactionKind: 'question',
            provider,
            toolCallId: 'claude-question-1',
          }),
        ]);

        expect(notifyAgentInterventionRequired).toHaveBeenCalledTimes(1);
        expect(notifyAgentInterventionRequired.mock.calls[0][0]).toMatchObject({
          items: [
            {
              detail: {
                questions: [
                  {
                    header: 'Producer ACK E2E',
                    id: 'question_1',
                    multiple: false,
                    options: [
                      {
                        description: 'Proceed with validation.',
                        id: 'Continue',
                        label: 'Continue',
                      },
                      {
                        description: 'Halt validation.',
                        id: 'Stop',
                        label: 'Stop',
                      },
                    ],
                    question: 'Continue read only validation?',
                  },
                ],
                title: 'Producer ACK E2E',
                type: 'question',
              },
              interactionKind: 'question',
              provider,
              summary: 'Continue read only validation?',
            },
          ],
          summary: 'Continue read only validation?',
        });
        expect(h.messageModel.updatePluginState).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            heterogeneousIntervention: expect.objectContaining({
              interactionKind: 'question',
              provider,
            }),
          }),
        );
      },
    );

    it('lets the user type their own answer to a heterogeneous question', async () => {
      const h = createHarness({ topicAgentId: 'agent-test' });

      await ingest(h, [
        buildEvent('agent_intervention_request', 0, {
          apiName: 'askUserQuestion',
          arguments: JSON.stringify({
            questions: [
              {
                header: 'Stack',
                multiSelect: false,
                options: [{ label: 'React' }, { label: 'Vue' }],
                question: 'Which framework?',
              },
              {
                header: 'Targets',
                multiSelect: true,
                options: [{ label: 'Web' }, { label: 'Desktop' }],
                question: 'Which targets?',
              },
            ],
          }),
          deadline: 1_900_000_000_000,
          identifier: 'claude-code',
          interactionKind: 'question',
          provider: 'claude-code',
          toolCallId: 'claude-question-custom',
        }),
      ]);

      // The shared AskUser form always offers "write your own", "type
      // directly" and a supplement note; without these capabilities the claim
      // rejects every typed answer as not matching the request.
      const detail = notifyAgentInterventionRequired.mock.calls[0][0].items[0].detail;
      expect(detail).toMatchObject({
        answerPolicy: { allowFreeform: true, allowSupplement: true },
        questions: [
          { allowCustomAnswer: true, question: 'Which framework?' },
          { allowCustomAnswer: true, question: 'Which targets?' },
        ],
        type: 'question',
      });
    });

    it('uses only the sanitized first question for a multi-question summary', async () => {
      const h = createHarness({ topicAgentId: 'agent-test' });

      await ingest(h, [
        buildEvent('agent_intervention_request', 0, {
          apiName: 'askUserQuestion',
          arguments: JSON.stringify({
            privateRawArgument: 'must not appear in the summary',
            questions: [
              {
                header: 'Validation',
                multiSelect: false,
                options: [
                  {
                    description: 'Sensitive option detail',
                    label: 'Continue',
                  },
                ],
                question: 'Which validation path should I use?',
              },
              {
                header: 'Follow-up',
                multiSelect: false,
                options: [{ label: 'Production' }],
                question: 'Which environment should I target?',
              },
            ],
          }),
          deadline: 1_900_000_000_000,
          identifier: 'claude-code',
          interactionKind: 'question',
          provider: 'claude-code',
          toolCallId: 'claude-question-summary',
        }),
      ]);

      const notification = notifyAgentInterventionRequired.mock.calls[0][0];
      expect(notification.summary).toBe('Which validation path should I use?');
      expect(notification.items[0].summary).toBe('Which validation path should I use?');
    });

    it('normalizes and safely truncates a long question summary', async () => {
      const h = createHarness({ topicAgentId: 'agent-test' });
      const longQuestion = `  Confirm\n\t${'😀'.repeat(170)}  now?  `;

      await ingest(h, [
        buildEvent('agent_intervention_request', 0, {
          apiName: 'askUserQuestion',
          arguments: JSON.stringify({
            questions: [
              {
                header: 'Long question',
                multiSelect: false,
                options: [{ label: 'Continue' }],
                question: longQuestion,
              },
            ],
          }),
          deadline: 1_900_000_000_000,
          identifier: 'claude-code',
          interactionKind: 'question',
          provider: 'claude-code',
          toolCallId: 'claude-long-question-summary',
        }),
      ]);

      const summary = notifyAgentInterventionRequired.mock.calls[0][0].summary;
      expect(summary).toBe(`Confirm ${'😀'.repeat(151)}…`);
      expect([...summary]).toHaveLength(160);
    });

    it('keeps the technical fallback when the sanitized question has no visible text', async () => {
      const h = createHarness({ topicAgentId: 'agent-test' });

      await ingest(h, [
        buildEvent('agent_intervention_request', 0, {
          apiName: 'askUserQuestion',
          arguments: JSON.stringify({
            questions: [
              {
                header: 'Blank question',
                multiSelect: false,
                options: [{ label: 'Continue' }],
                question: ' \n\t ',
              },
            ],
          }),
          deadline: 1_900_000_000_000,
          identifier: 'claude-code',
          interactionKind: 'question',
          provider: 'claude-code',
          toolCallId: 'claude-blank-question-summary',
        }),
      ]);

      const notification = notifyAgentInterventionRequired.mock.calls[0][0];
      expect(notification.summary).toBe('claude-code question: askUserQuestion');
      expect(notification.items[0].summary).toBe('claude-code question: askUserQuestion');
    });

    it('notifies pending once, ignores the publish leg, and notifies terminal only on ACK', async () => {
      const h = createHarness({ topicAgentId: 'agent-test' });
      const requestId = '018fbd8e-7baf-7c6d-8000-000000000001';
      const request = buildEvent('agent_intervention_request', 0, {
        apiName: 'askUserQuestion',
        arguments: JSON.stringify({
          privateRawArgument: 'must be stripped',
          questions: [
            {
              header: 'Permission',
              multiSelect: false,
              options: [
                { id: 'allow', label: 'Allow', raw: 'strip me' },
                { id: 'deny', label: 'Deny' },
              ],
              question: 'Run command?',
            },
          ],
        }),
        deadline: 1_900_000_000_000,
        identifier: 'devin',
        interactionKind: 'permission',
        provider: 'devin',
        toolCallId: 'permission-1',
      });

      await ingest(h, [request]);
      await ingest(h, [{ ...request, timestamp: request.timestamp + 1 }]);

      expect(notifyAgentInterventionRequired).toHaveBeenCalledTimes(1);
      const pending = notifyAgentInterventionRequired.mock.calls[0][0];
      expect(pending).toMatchObject({
        agentId: 'agent-test',
        approvalMode: 'manual',
        batch: {
          allowedActions: [],
          id: 'op-test:0:asst-seeded:permission-1',
          kind: 'single',
          sealed: true,
          stepIndex: 0,
        },
        context: {
          assistantMessageId: 'asst-seeded',
          operationId: 'op-test',
          topicId: 'topic-test',
        },
        items: [
          {
            allowedActions: ['select_provider_option', 'skip_interaction'],
            detail: {
              description: 'Permission',
              options: [
                { description: undefined, id: 'allow', label: 'Allow' },
                { description: undefined, id: 'deny', label: 'Deny' },
              ],
              title: 'Run command?',
              type: 'permission',
            },
            interactionKind: 'permission',
            provider: 'devin',
            sourceRef: {
              operationId: 'op-test',
              toolCallId: 'permission-1',
              type: 'heterogeneous',
            },
            surface: 'form',
          },
        ],
        systemActionEligibility: 'review_only',
      });
      expect(pending.batch.activityKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(pending.items[0].requestRevision).toEqual({
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        version: 1,
      });
      expect(JSON.stringify(pending)).not.toContain('privateRawArgument');

      await ingest(h, [
        buildEvent('agent_intervention_response', 1, {
          producerAck: false,
          resolutionRequestId: requestId,
          result: { 'Run command?': 'allow' },
          toolCallId: 'permission-1',
        }),
      ]);
      expect(notifyAgentInterventionRequired).toHaveBeenCalledTimes(1);
      expect(acknowledgeAgentInterventionProducerResolution).not.toHaveBeenCalled();

      const producerAck = buildEvent('agent_intervention_response', 2, {
        producerAck: true,
        resolutionRequestId: requestId,
        result: { 'Run command?': 'allow' },
        toolCallId: 'permission-1',
      });
      await ingest(h, [producerAck]);
      await ingest(h, [{ ...producerAck, timestamp: producerAck.timestamp + 1 }]);

      expect(notifyAgentInterventionRequired).toHaveBeenCalledTimes(1);
      expect(acknowledgeAgentInterventionProducerResolution).toHaveBeenCalledTimes(1);
      expect(acknowledgeAgentInterventionProducerResolution).toHaveBeenCalledWith({
        operationId: 'op-test',
        ownerUserId: 'user-test',
        resolutionRequestId: requestId,
        status: 'resolved',
        toolCallId: 'permission-1',
        workspaceId: undefined,
      });
    });

    it('gives concurrent callbacks in one assistant step distinct sealed batch identities', async () => {
      const h = createHarness({ topicAgentId: 'agent-test' });
      const intervention = (toolCallId: string) =>
        buildEvent('agent_intervention_request', 0, {
          apiName: 'askUserQuestion',
          arguments: JSON.stringify({
            questions: [
              {
                header: 'Question',
                multiSelect: false,
                options: [{ label: 'Continue' }],
                question: `Continue ${toolCallId}?`,
              },
            ],
          }),
          deadline: 1_900_000_000_000,
          identifier: 'claude-code',
          interactionKind: 'question',
          provider: 'claude-code',
          toolCallId,
        });

      await ingest(h, [intervention('question-1'), intervention('question-2')]);

      expect(notifyAgentInterventionRequired).toHaveBeenCalledTimes(2);
      const notifications = notifyAgentInterventionRequired.mock.calls.map(([params]) => params);
      expect(notifications.map(({ batch }) => batch.id)).toEqual([
        'op-test:0:asst-seeded:question-1',
        'op-test:0:asst-seeded:question-2',
      ]);
      expect(new Set(notifications.map(({ batch }) => batch.activityKey)).size).toBe(2);
      expect(notifications.every(({ batch }) => batch.allowedActions.length === 0)).toBe(true);
      for (const notification of notifications) {
        expect(notification.items[0].allowedActions).toEqual([
          'submit_answers',
          'skip_interaction',
        ]);
      }
    });

    it('matches Web plan actions without advertising reserved cancel', async () => {
      const h = createHarness({ topicAgentId: 'agent-test' });
      await ingest(h, [
        buildEvent('agent_intervention_request', 0, {
          apiName: 'askUserQuestion',
          arguments: JSON.stringify({
            questions: [
              {
                header: 'Plan',
                multiSelect: false,
                options: [{ id: 'accept', label: 'Accept plan' }],
                question: 'Proceed with this plan?',
              },
            ],
          }),
          deadline: 1_900_000_000_000,
          identifier: 'cursor',
          interactionKind: 'plan',
          provider: 'cursor',
          toolCallId: 'plan-1',
        }),
      ]);

      const pending = notifyAgentInterventionRequired.mock.calls[0][0];
      expect(pending.items[0]).toMatchObject({
        allowedActions: ['select_provider_option', 'skip_interaction'],
        interactionKind: 'plan',
      });
      expect(pending.items[0].allowedActions).not.toContain('cancel_interaction');
    });
  });
});
