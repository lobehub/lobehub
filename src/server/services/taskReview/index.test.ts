// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { TaskReviewService } from './index';

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

vi.mock('@lobechat/eval-rubric', () => ({
  evaluate: vi.fn(),
}));

const { evaluate } = await import('@lobechat/eval-rubric');

describe('TaskReviewService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockUserModel = {
    getUserSettings: vi.fn(),
  };

  const mockModelRuntime = {
    generateObject: vi.fn(),
  };

  const mockEvaluateResult = {
    passed: true,
    rubricResults: [{ passed: true, rubricId: 'r1', score: 0.9 }],
    score: 0.9,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (UserModel as any).mockImplementation(() => mockUserModel);
    (initModelRuntimeFromDB as any).mockResolvedValue(mockModelRuntime);
    (evaluate as any).mockResolvedValue(mockEvaluateResult);
  });

  describe('review', () => {
    const baseParams = {
      content: 'The task was completed successfully with all requirements met.',
      judge: { model: 'gpt-5.4-mini', provider: 'openai' },
      rubrics: [{ id: 'r1', name: 'Correctness', type: 'llm-judge', weight: 1, config: {} as any }],
      taskName: 'Test Task',
    };

    it('should return a passed ReviewResult when evaluation passes', async () => {
      const service = new TaskReviewService(db, userId);
      const result = await service.review(baseParams);

      expect(result.passed).toBe(true);
      expect(result.overallScore).toBe(90); // 0.9 * 100 rounded
      expect(result.rubricResults).toHaveLength(1);
      expect(result.suggestions).toEqual([]);
      expect(result.iteration).toBe(1);
    });

    it('should return a failed ReviewResult when evaluation fails', async () => {
      (evaluate as any).mockResolvedValue({
        passed: false,
        rubricResults: [{ passed: false, rubricId: 'r1', score: 0.4 }],
        score: 0.4,
      });

      const service = new TaskReviewService(db, userId);
      const result = await service.review(baseParams);

      expect(result.passed).toBe(false);
      expect(result.overallScore).toBe(40);
    });

    it('should use provided iteration number', async () => {
      const service = new TaskReviewService(db, userId);
      const result = await service.review({ ...baseParams, iteration: 3 });

      expect(result.iteration).toBe(3);
    });

    it('should default iteration to 1 when not provided', async () => {
      const service = new TaskReviewService(db, userId);
      const result = await service.review(baseParams);

      expect(result.iteration).toBe(1);
    });

    it('should use judge model and provider when both are specified', async () => {
      const service = new TaskReviewService(db, userId);
      await service.review(baseParams);

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(db, userId, 'openai');
      expect(UserModel).not.toHaveBeenCalled();
    });

    it('should pass correct content and rubrics to evaluate', async () => {
      const service = new TaskReviewService(db, userId);
      await service.review(baseParams);

      expect(evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          actual: baseParams.content,
          rubrics: baseParams.rubrics,
          testCase: { input: baseParams.taskName },
        }),
        expect.objectContaining({
          passThreshold: 0.6,
        }),
      );
    });

    it('should pass matchContext with generateObject to evaluate', async () => {
      const service = new TaskReviewService(db, userId);
      await service.review(baseParams);

      expect(evaluate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          matchContext: expect.objectContaining({
            generateObject: expect.any(Function),
            judgeModel: 'gpt-5.4-mini',
          }),
        }),
      );
    });

    it('matchContext.generateObject should delegate to modelRuntime.generateObject', async () => {
      mockModelRuntime.generateObject.mockResolvedValue({ score: 0.9 });

      let capturedMatchContext: any;
      (evaluate as any).mockImplementation(async (_params: any, options: any) => {
        capturedMatchContext = options.matchContext;
        return mockEvaluateResult;
      });

      const service = new TaskReviewService(db, userId);
      await service.review(baseParams);

      const payload = {
        messages: [{ role: 'user', content: 'Evaluate this' }],
        model: 'gpt-5.4-mini',
        schema: { prop: 'score' },
      };
      await capturedMatchContext.generateObject(payload);

      expect(mockModelRuntime.generateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: payload.messages,
          model: payload.model,
          schema: { name: 'judge_score', schema: payload.schema },
        }),
        { metadata: { trigger: 'task-review' } },
      );
    });

    it('should round overallScore to integer', async () => {
      (evaluate as any).mockResolvedValue({
        passed: true,
        rubricResults: [],
        score: 0.666,
      });

      const service = new TaskReviewService(db, userId);
      const result = await service.review(baseParams);

      expect(result.overallScore).toBe(67); // Math.round(0.666 * 100)
    });
  });

  describe('resolveModelConfig (via review)', () => {
    it('should fall back to user settings when judge config is incomplete', async () => {
      mockUserModel.getUserSettings.mockResolvedValue({
        systemAgent: {
          topic: { model: 'user-model', provider: 'user-provider' },
        },
      });

      const service = new TaskReviewService(db, userId);
      await service.review({
        content: 'content',
        judge: {}, // no model/provider
        rubrics: [{ id: 'r1', name: 'Test', type: 'llm-judge', weight: 1, config: {} as any }],
        taskName: 'task',
      });

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(db, userId, 'user-provider');
    });

    it('should fall back to default system agent config when user has no topic config', async () => {
      mockUserModel.getUserSettings.mockResolvedValue({
        systemAgent: {},
      });

      const service = new TaskReviewService(db, userId);
      await service.review({
        content: 'content',
        judge: {}, // no model/provider
        rubrics: [{ id: 'r1', name: 'Test', type: 'llm-judge', weight: 1, config: {} as any }],
        taskName: 'task',
      });

      // Should use DEFAULT_MINI_PROVIDER (openai) from defaults
      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(db, userId, 'openai');
    });

    it('should fall back to defaults when user settings are null', async () => {
      mockUserModel.getUserSettings.mockResolvedValue(null);

      const service = new TaskReviewService(db, userId);
      await service.review({
        content: 'content',
        judge: {},
        rubrics: [{ id: 'r1', name: 'Test', type: 'llm-judge', weight: 1, config: {} as any }],
        taskName: 'task',
      });

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(db, userId, 'openai');
    });

    it('should use judge.model when only model is specified (not provider)', async () => {
      mockUserModel.getUserSettings.mockResolvedValue({
        systemAgent: {
          topic: { model: 'user-model', provider: 'user-provider' },
        },
      });

      const service = new TaskReviewService(db, userId);
      await service.review({
        content: 'content',
        judge: { model: 'custom-model' }, // model but no provider
        rubrics: [{ id: 'r1', name: 'Test', type: 'llm-judge', weight: 1, config: {} as any }],
        taskName: 'task',
      });

      // Provider falls back to user settings
      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(db, userId, 'user-provider');
    });
  });
});
