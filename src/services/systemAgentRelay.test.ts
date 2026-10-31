import { DEFAULT_VERIFY_PLAN_MODEL, DEFAULT_VERIFY_PLAN_PROVIDER } from '@lobechat/business-const';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { oneShotRelay } from '@/services/llmRelay';
import { useUserStore } from '@/store/user';

import { expertiseService } from './expertise';
import { goalService } from './goal';
import { taskService } from './task';
import { verifyService } from './verify';

vi.mock('@/libs/trpc/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  lambdaClient: {
    expertise: {
      draftDomain: { mutate: vi.fn(async () => ({})) },
      draftRule: { mutate: vi.fn(async () => ({})) },
      draftRuleGroup: { mutate: vi.fn(async () => ({})) },
      distillRules: { mutate: vi.fn(async () => ({})) },
      judgeRuleDirections: { mutate: vi.fn(async () => ({ judged: 0 })) },
    },
    goal: {
      advance: { mutate: vi.fn(async () => ({ data: {} })) },
      tick: { mutate: vi.fn(async () => ({ data: {} })) },
    },
    task: {
      analyzeIntent: { mutate: vi.fn(async () => ({})) },
      runReview: { mutate: vi.fn(async () => ({ data: {} })) },
      synthesizeInstruction: { mutate: vi.fn(async () => ({})) },
    },
    verify: {
      executeVerify: { mutate: vi.fn(async () => []) },
      generateCriteria: { mutate: vi.fn(async () => []) },
      generateDraftPlan: { mutate: vi.fn(async () => []) },
      generateGoalCriteria: { mutate: vi.fn(async () => []) },
      generateGoalPlan: { mutate: vi.fn(async () => undefined) },
    },
  },
}));
vi.mock('@/services/llmRelay', () => ({
  buildLlmExecutorDeclaration: vi.fn(() => ({ providers: ['ollama', 'lmstudio'] })),
  oneShotRelay: { run: vi.fn() },
}));

const RELAY = {
  channel: 'llmcall:user-1:abcdefgh',
  headers: { 'x-lobe-client-id': 'tab-1', 'x-lobe-llm-relay-channel': 'llmcall:user-1:abcdefgh' },
};
const RELAY_OPTIONS = { context: { llmRelayHeaders: RELAY.headers } };

// These browser entries reach server tasks (AiGenerationService) that run on a
// system-agent model. With that model on a device-only provider the server
// relays the call back to the requesting tab — which only works when the
// request names the channel this tab subscribed; without it the server answers
// `no_executor` (no_client_request).
describe('system-agent browser entries and the one-shot relay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(oneShotRelay.run).mockImplementation(async (_provider, request) => request(RELAY));
    act(() => {
      useUserStore.setState({
        settings: {
          systemAgent: {
            expertise: { enabled: true, model: 'qwen3-1.7b', provider: 'lmstudio' },
            goal: { enabled: true, model: 'qwen3:1.7b', provider: 'ollama' },
          },
        } as any,
      });
    });
  });

  describe('goal model (task intent, goal criteria)', () => {
    it('analyzeIntent', async () => {
      const params = { instruction: 'ship it' };
      await taskService.analyzeIntent(params);

      expect(oneShotRelay.run).toHaveBeenCalledWith('ollama', expect.any(Function));
      expect(lambdaClient.task.analyzeIntent.mutate).toHaveBeenCalledWith(params, RELAY_OPTIONS);
    });

    it('synthesizeInstruction', async () => {
      const params = { answers: [], instruction: 'ship it' };
      await taskService.synthesizeInstruction(params);

      expect(oneShotRelay.run).toHaveBeenCalledWith('ollama', expect.any(Function));
      expect(lambdaClient.task.synthesizeInstruction.mutate).toHaveBeenCalledWith(
        params,
        RELAY_OPTIONS,
      );
    });

    it('generateGoalCriteria', async () => {
      const params = { goal: 'ship it' };
      await verifyService.generateGoalCriteria(params);

      expect(oneShotRelay.run).toHaveBeenCalledWith('ollama', expect.any(Function));
      expect(lambdaClient.verify.generateGoalCriteria.mutate).toHaveBeenCalledWith(
        params,
        RELAY_OPTIONS,
      );
    });

    // `goal.advance` / `goal.tick` decompose and explore the goal inline, on
    // the goal model, inside the request.
    it('goal advance', async () => {
      await goalService.advance('goal-1');

      expect(oneShotRelay.run).toHaveBeenCalledWith('ollama', expect.any(Function));
      expect(lambdaClient.goal.advance.mutate).toHaveBeenCalledWith(
        { id: 'goal-1' },
        RELAY_OPTIONS,
      );
    });

    it('goal tick', async () => {
      await goalService.tick('goal-1');

      expect(oneShotRelay.run).toHaveBeenCalledWith('ollama', expect.any(Function));
      expect(lambdaClient.goal.tick.mutate).toHaveBeenCalledWith({ id: 'goal-1' }, RELAY_OPTIONS);
    });

    it('generateGoalPlan', async () => {
      const params = { goal: 'ship it' };
      await verifyService.generateGoalPlan(params);

      expect(oneShotRelay.run).toHaveBeenCalledWith('ollama', expect.any(Function));
      expect(lambdaClient.verify.generateGoalPlan.mutate).toHaveBeenCalledWith(
        params,
        RELAY_OPTIONS,
      );
    });
  });

  describe('expertise model (rules, domains)', () => {
    it('draftRule', async () => {
      const params = { brief: 'be brief', groups: [] };
      await expertiseService.draftRule(params);

      expect(oneShotRelay.run).toHaveBeenCalledWith('lmstudio', expect.any(Function));
      expect(lambdaClient.expertise.draftRule.mutate).toHaveBeenCalledWith(params, RELAY_OPTIONS);
    });

    it('draftRuleGroup', async () => {
      await expertiseService.draftRuleGroup('a group');

      expect(oneShotRelay.run).toHaveBeenCalledWith('lmstudio', expect.any(Function));
      expect(lambdaClient.expertise.draftRuleGroup.mutate).toHaveBeenCalledWith(
        { brief: 'a group' },
        RELAY_OPTIONS,
      );
    });

    it('distillRules', async () => {
      const params = { agentId: 'agt', sources: [] } as any;
      await expertiseService.distillRules(params);

      expect(oneShotRelay.run).toHaveBeenCalledWith('lmstudio', expect.any(Function));
      expect(lambdaClient.expertise.distillRules.mutate).toHaveBeenCalledWith(
        params,
        RELAY_OPTIONS,
      );
    });

    it('judgeRuleDirections', async () => {
      await expertiseService.judgeRuleDirections(['l1']);

      expect(oneShotRelay.run).toHaveBeenCalledWith('lmstudio', expect.any(Function));
      expect(lambdaClient.expertise.judgeRuleDirections.mutate).toHaveBeenCalledWith(
        { lessonIds: ['l1'] },
        RELAY_OPTIONS,
      );
    });

    it('draftDomain', async () => {
      const params = { agentId: 'agt', brief: 'brief' };
      await expertiseService.draftDomain(params);

      expect(oneShotRelay.run).toHaveBeenCalledWith('lmstudio', expect.any(Function));
      expect(lambdaClient.expertise.draftDomain.mutate).toHaveBeenCalledWith(params, RELAY_OPTIONS);
    });
  });

  describe('verify', () => {
    it('generateCriteria runs on the pinned plan model', async () => {
      const params = { goal: 'ship it' };
      await verifyService.generateCriteria(params);

      expect(DEFAULT_VERIFY_PLAN_MODEL).toBeTruthy();
      expect(oneShotRelay.run).toHaveBeenCalledWith(
        DEFAULT_VERIFY_PLAN_PROVIDER,
        expect.any(Function),
      );
      expect(lambdaClient.verify.generateCriteria.mutate).toHaveBeenCalledWith(
        params,
        RELAY_OPTIONS,
      );
    });

    it('generateDraftPlan runs on the pinned plan model', async () => {
      const params = { goal: 'ship it', operationId: 'op' };
      await verifyService.generateDraftPlan(params);

      expect(oneShotRelay.run).toHaveBeenCalledWith(
        DEFAULT_VERIFY_PLAN_PROVIDER,
        expect.any(Function),
      );
      expect(lambdaClient.verify.generateDraftPlan.mutate).toHaveBeenCalledWith(
        params,
        RELAY_OPTIONS,
      );
    });

    it('executeVerify runs on the model it names', async () => {
      const params = {
        deliverable: 'd',
        goal: 'g',
        modelConfig: { model: 'qwen3:1.7b', provider: 'ollama' },
        operationId: 'op',
      };
      await verifyService.executeVerify(params);

      expect(oneShotRelay.run).toHaveBeenCalledWith('ollama', expect.any(Function));
      expect(lambdaClient.verify.executeVerify.mutate).toHaveBeenCalledWith(params, RELAY_OPTIONS);
    });
  });

  describe('task review', () => {
    // The judge model is resolved on the server (task judge, else the topic
    // model), so any device provider this tab runs is reason to stand by.
    it('runReview stands by for every device provider this tab runs', async () => {
      await taskService.runReview('task-1', { content: 'done' });

      const providers = vi.mocked(oneShotRelay.run).mock.calls[0][0] as () => string[];
      expect(providers()).toEqual(['ollama', 'lmstudio']);
      expect(lambdaClient.task.runReview.mutate).toHaveBeenCalledWith(
        { content: 'done', id: 'task-1' },
        RELAY_OPTIONS,
      );
    });
  });
});
