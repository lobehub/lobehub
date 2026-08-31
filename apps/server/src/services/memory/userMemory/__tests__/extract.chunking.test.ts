import { describe, expect, it, vi } from 'vitest';

import type * as UserMemoryModels from '@/database/models/userMemory';
import type { UserMemoryHybridSearchAggregatedResult } from '@/database/models/userMemory';

import { MemoryExtractionExecutor } from '../extract';

const mocks = vi.hoisted(() => ({
  getServerDB: vi.fn(),
  searchMemory: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('@/database/models/userMemory', async (importOriginal) => {
  const original = await importOriginal<typeof UserMemoryModels>();
  return {
    ...original,
    UserMemoryModel: vi.fn().mockImplementation(() => ({
      searchMemory: mocks.searchMemory,
    })),
  };
});

/**
 * Executor-level regression test for the long-conversation embedding fix:
 * `listRelevantUserMemories` must receive UNTRIMMED conversations and chunk
 * them internally, so references only present in the head of a long topic
 * stay retrievable (instead of being dropped by pret-trimming in extractTopic).
 */

const createExecutor = () => {
  const serverConfig = { aiProvider: {}, memory: {} };
  // db 是字段初始化器，构造时即调用 getServerDB()：必须先 mock 再 new
  mocks.getServerDB.mockReturnValue({});
  // @ts-ignore accessing private constructor for testing
  return new MemoryExtractionExecutor(serverConfig as any, {
    agentBenchmarkLoCoMo: { model: 'benchmark-1', provider: 'provider-b' },
    agentGateKeeper: { model: 'gate-2', provider: 'provider-b' },
    agentLayerExtractor: {
      contextLimit: 2048,
      layers: {
        activity: 'layer-act',
        context: 'layer-ctx',
        experience: 'layer-exp',
        identity: 'layer-id',
        preference: 'layer-pref',
      },
      model: 'layer-1',
      provider: 'provider-l',
    },
    agentPersonaWriter: { model: 'persona-1', provider: 'provider-s' },
    concurrency: 1,
    embedding: { model: 'embed-1', provider: 'provider-e' },
    featureFlags: { enableBenchmarkLoCoMo: false },
    observabilityS3: { enabled: false },
    webhook: {},
  });
};

const emptySearchResult: UserMemoryHybridSearchAggregatedResult = {
  activities: [],
  contexts: [],
  experiences: [],
  identities: [],
  preferences: [],
};

describe('MemoryExtractionExecutor.listRelevantUserMemories (embedding chunking)', () => {
  it('chunks the untrimmed conversation and keeps the head retrievable', async () => {
    const executor = createExecutor();
    mocks.searchMemory.mockResolvedValue(emptySearchResult);

    const headSentence = 'C我和妻子的结婚纪念日是每年6月18日。';
    const conversations = [
      // 对话头部：只出现在最老的消息里的关键上下文
      { id: 'msg-1', role: 'user', content: headSentence, createdAt: new Date('2026-01-01') },
      // 中间填充，让整段对话远超 embedding 上下文上限
      ...Array.from({ length: 60 }, (_, i) => ({
        id: `msg-fill-${i}`,
        role: 'assistant',
        content:
          `这是第${i}条用于把对话撑长的中间填充消息，内容本身没有检索价值，只是为了让整段聚合文本超过 embedding 上下文限制，从而触发内部切块而不是单条 embedding。`.repeat(
            3,
          ),
        createdAt: new Date(2026, 0, 1 + i / 100),
      })),
      {
        id: 'msg-last',
        role: 'user',
        content: '用户问：我最近聊了哪些话题？',
        createdAt: new Date('2026-02-01'),
      },
    ] as const;

    const embeddingsInput: string[] = [];
    const runtime = {
      embeddings: vi.fn(async ({ input }: { input: string[] }) => {
        embeddingsInput.push(...input);
        return input.map(() => Array.from({ length: 1024 }, () => 0.1));
      }),
    };

    // 直接走 executor 私有入口：传完整 conversations（不预设裁剪）
    await (executor as any).listRelevantUserMemories(
      {},
      runtime,
      'embed-1',
      'user-1',
      [...conversations],
      256, // 很小的 token 上限，强制切块
    );

    // 1. 内部切块 → embedding 收到多块（而不是单条整体/预裁剪尾部）
    expect(embeddingsInput.length).toBeGreaterThan(1);

    // 2. 头部的话术仍然完整出现在某一块里（未被 trim 掉）
    expect(embeddingsInput.some((chunk) => chunk.includes(headSentence))).toBe(true);

    // 3. searchMemory 收到的 queries 与向量数目一致（多 query 多向量）
    expect(mocks.searchMemory).toHaveBeenCalled();
    const searchCall = mocks.searchMemory.mock.calls[0]!;
    expect(searchCall[0].queries.length).toBe(embeddingsInput.length);

    // 4. 每块都不超 token 上限（P2 边界校验）
    const { estimateTokenCount } = await import('tokenx');
    for (const chunk of embeddingsInput) {
      const tokens = estimateTokenCount(chunk);
      expect(tokens).toBeLessThanOrEqual(256 + 16); // 允许极小余量
    }
  });
});
