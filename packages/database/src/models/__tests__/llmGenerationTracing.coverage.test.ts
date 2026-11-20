// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { llmGenerationTracing, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { LlmGenerationTracingModel } from '../llmGenerationTracing';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 't863-llm-trace-cov-user';
const tracingId = '8f6b2c1e-4d3a-4b5c-9e7f-0a1b2c3d4e5f';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(llmGenerationTracing).where(eq(llmGenerationTracing.id, tracingId));
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('LlmGenerationTracingModel coverage', () => {
  it('keeps a caller-supplied id instead of generating one', async () => {
    const model = new LlmGenerationTracingModel(serverDB, userId);

    const { id } = await model.record({
      id: tracingId,
      model: 'gpt-4o-mini',
      promptHash: 'ab1fc3',
      promptVersion: 'v1.0',
      provider: 'openai',
      scenario: 'home_brief',
      schemaName: 'HomeBriefOutputSchema',
      success: true,
      trigger: 'home_brief',
    });

    expect(id).toBe(tracingId);
    const [row] = await serverDB
      .select()
      .from(llmGenerationTracing)
      .where(eq(llmGenerationTracing.id, tracingId));
    expect(row).toMatchObject({ id: tracingId, model: 'gpt-4o-mini', userId });
  });
});
