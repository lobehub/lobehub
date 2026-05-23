// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { llmGenerationTracing, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { LlmGenerationTracingModel } from '../llmGenerationTracing';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'llm-gen-trace-test-user';
const otherUserId = 'llm-gen-trace-other-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(llmGenerationTracing);
  await serverDB.delete(users);
});

describe('LlmGenerationTracingModel', () => {
  describe('record', () => {
    it('inserts a row and returns the generated uuid', async () => {
      const model = new LlmGenerationTracingModel(serverDB, userId);

      const { id } = await model.record({
        inputHint: 'hello world',
        inputTokens: 120,
        latencyMs: 850,
        model: 'gpt-4o-mini',
        outputTokens: 40,
        promptHash: 'ab1fc3',
        promptVersion: 'v1.0',
        provider: 'openai',
        scenario: 'home_brief',
        schemaName: 'HomeBriefOutputSchema',
        success: true,
        trigger: 'home_brief',
      });

      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const row = await model.findById(id);
      expect(row).toMatchObject({
        id,
        inputHint: 'hello world',
        inputTokens: 120,
        latencyMs: 850,
        metadata: {},
        model: 'gpt-4o-mini',
        outputTokens: 40,
        promptHash: 'ab1fc3',
        promptVersion: 'v1.0',
        provider: 'openai',
        scenario: 'home_brief',
        schemaName: 'HomeBriefOutputSchema',
        success: true,
        trigger: 'home_brief',
        userId,
        validationFailed: false,
      });
      expect(row?.createdAt).toBeInstanceOf(Date);
    });

    it('records a failure with error fields and validation flag', async () => {
      const model = new LlmGenerationTracingModel(serverDB, userId);

      const { id } = await model.record({
        errorCode: 'validation_failed',
        errorDetail: 'output missing required field "summary"',
        latencyMs: 1200,
        model: 'gpt-4o',
        promptHash: 'cccccc',
        promptVersion: 'v1.0',
        provider: 'openai',
        scenario: 'topic_title',
        success: false,
        validationFailed: true,
      });

      const row = await model.findById(id);
      expect(row).toMatchObject({
        errorCode: 'validation_failed',
        errorDetail: 'output missing required field "summary"',
        success: false,
        validationFailed: true,
      });
    });
  });

  describe('updateFeedback', () => {
    it('writes feedback columns and the updated timestamp', async () => {
      const model = new LlmGenerationTracingModel(serverDB, userId);
      const { id } = await model.record({
        promptHash: 'aaaaaa',
        promptVersion: 'v1.0',
        scenario: 'agent_welcome',
        success: true,
      });

      await model.updateFeedback(id, {
        data: { clicked_question_index: 1 },
        score: 1,
        signal: 'positive',
        source: 'explicit_thumbs',
      });

      const row = await model.findById(id);
      expect(row).toMatchObject({
        feedbackData: { clicked_question_index: 1 },
        feedbackScore: 1,
        feedbackSignal: 'positive',
        feedbackSource: 'explicit_thumbs',
      });
      expect(row?.feedbackUpdatedAt).toBeInstanceOf(Date);
    });

    it("does not touch another user's row", async () => {
      const owner = new LlmGenerationTracingModel(serverDB, userId);
      const intruder = new LlmGenerationTracingModel(serverDB, otherUserId);

      const { id } = await owner.record({
        promptHash: 'aaaaaa',
        promptVersion: 'v1.0',
        scenario: 'follow_up',
        success: true,
      });

      await intruder.updateFeedback(id, {
        signal: 'negative',
        source: 'manual_edit',
      });

      const row = await owner.findById(id);
      expect(row?.feedbackSignal).toBeNull();
    });
  });

  describe('findById / listRecent', () => {
    it('only returns rows owned by the caller', async () => {
      const owner = new LlmGenerationTracingModel(serverDB, userId);
      const stranger = new LlmGenerationTracingModel(serverDB, otherUserId);

      const { id } = await owner.record({
        promptHash: 'aaaaaa',
        promptVersion: 'v1.0',
        scenario: 'memory_extract',
        success: true,
      });

      expect(await stranger.findById(id)).toBeNull();
      expect(await stranger.listRecent()).toHaveLength(0);

      const rows = await owner.listRecent();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(id);
    });
  });
});
