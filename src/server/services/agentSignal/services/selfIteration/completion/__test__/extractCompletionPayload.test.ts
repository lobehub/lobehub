import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it } from 'vitest';

import { extractSelfIterationCompletionPayload } from '../extractCompletionPayload';

const toolMessage = (apiName: string, kind: string, data: Record<string, unknown>) => ({
  apiName,
  content: JSON.stringify({ kind, ...data }),
  role: 'tool',
  tool_call_id: `${apiName}_call`,
});

const buildState = (metadata: Record<string, unknown>, messages: unknown[] = []) => ({
  messages,
  metadata,
});

const validMetadata = {
  agentId: BUILTIN_AGENT_SLUGS.nightlyReview,
  agentSignal: { kind: 'nightly-review', sourceId: 'src_1' },
  userId: 'user_1',
};

describe('extractSelfIterationCompletionPayload', () => {
  it('returns undefined for a non-self-iteration agent', () => {
    expect(
      extractSelfIterationCompletionPayload(
        buildState({ agentId: 'lobe-chat-agent', userId: 'user_1' }),
      ),
    ).toBeUndefined();
  });

  it('returns undefined when the operation carries no agent-signal marker', () => {
    expect(
      extractSelfIterationCompletionPayload(
        buildState({ agentId: BUILTIN_AGENT_SLUGS.nightlyReview, userId: 'user_1' }),
      ),
    ).toBeUndefined();
  });

  it('returns undefined without a userId', () => {
    expect(
      extractSelfIterationCompletionPayload(
        buildState({
          agentId: BUILTIN_AGENT_SLUGS.nightlyReview,
          agentSignal: { kind: 'nightly-review' },
        }),
      ),
    ).toBeUndefined();
  });

  it('extracts mutations, artifacts and marker for a valid self-iteration run', () => {
    const result = extractSelfIterationCompletionPayload(
      buildState(validMetadata, [
        toolMessage('writeMemory', 'mutation', { resourceId: 'mem_1' }),
        toolMessage('getManagedSkill', 'read', { items: [] }),
        toolMessage('recordSelfReviewIdea', 'artifact', { idea: 'x' }),
      ]),
    );

    expect(result?.marker.kind).toBe('nightly-review');
    expect(result?.userId).toBe('user_1');
    expect(result?.mutations).toHaveLength(1);
    expect(result?.mutations[0].apiName).toBe('writeMemory');
    expect(result?.artifacts).toHaveLength(1);
    expect(result?.artifacts[0].apiName).toBe('recordSelfReviewIdea');
  });
});
