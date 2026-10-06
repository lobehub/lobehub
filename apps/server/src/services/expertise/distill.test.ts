// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DistillRulesInputSchema, ExpertiseRuleDistillService } from './distill';

const {
  assertContentsNotInRestrictedKnowledgeBase,
  resolveExpertiseModelConfig,
  findDocument,
  findTopic,
  transcript,
  parseFile,
} = vi.hoisted(() => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
  findDocument: vi.fn(),
  findTopic: vi.fn(),
  parseFile: vi.fn(),
  resolveExpertiseModelConfig: vi.fn(),
  transcript: vi.fn(),
}));
const generateObject = vi.fn();

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = generateObject;
  },
}));
vi.mock('./modelConfig', () => ({ resolveExpertiseModelConfig }));
vi.mock('@/database/models/document', () => ({
  DocumentModel: class {
    findById = findDocument;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = findTopic;
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    queryTopicTranscript = transcript;
  },
}));
vi.mock('@/server/services/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase,
}));
vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    parseFile = parseFile;
  },
}));

const groups = [{ gate: '换一个仓库还成立吗？', id: 'g-eng', title: '工程规范' }];
const rules = [{ id: 'r-rebase', title: '交付分支必须先 rebase 到 canary' }];

const candidate = (overrides: Record<string, unknown>) => ({
  compilability: 'not-compilable',
  duplicateOf: null,
  enforcement: 'remind',
  groupId: null,
  how: null,
  limits: null,
  newGroup: null,
  quote: '',
  title: 'rule',
  why: null,
  ...overrides,
});

const service = () => new ExpertiseRuleDistillService({} as never, 'user_1');

describe('ExpertiseRuleDistillService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveExpertiseModelConfig.mockResolvedValue({ model: 'm', provider: 'p' });
    assertContentsNotInRestrictedKnowledgeBase.mockResolvedValue(undefined);
  });

  it('proposes every rule a pasted guideline states, keeping only ids the reviewer has', async () => {
    generateObject.mockResolvedValue({
      rules: [
        candidate({
          duplicateOf: 'r-rebase',
          groupId: 'g-eng',
          newGroup: { gate: 'x', title: 'y' },
          quote: '  提交前 rebase 到 canary  ',
          title: '交付前先 rebase 到 canary',
        }),
        candidate({
          duplicateOf: 'r-invented',
          groupId: 'g-invented',
          newGroup: { gate: '是在约束界面文案吗？', title: '界面文案' },
          title: '按钮文案用动词',
        }),
      ],
    });

    const result = await service().distillRules({
      groups,
      rules,
      source: { text: '# 前端规范\n1. 提交前 rebase 到 canary\n2. 按钮文案用动词', type: 'text' },
    });

    expect(result.material).toEqual({
      subjectId: null,
      subjectType: 'standalone',
      title: '前端规范',
      truncated: false,
      type: 'text',
    });
    expect(result.candidates[0]).toMatchObject({
      duplicateOf: 'r-rebase',
      groupId: 'g-eng',
      // A matched group wins over a proposed one.
      newGroup: null,
      quote: '提交前 rebase 到 canary',
    });
    // Ids the model invented are dropped; its proposed group is kept instead.
    expect(result.candidates[1]).toMatchObject({
      duplicateOf: null,
      groupId: null,
      newGroup: { gate: '是在约束界面文案吗？', title: '界面文案' },
    });
    const [params, options] = generateObject.mock.calls[0];
    expect(params.schema.name).toBe('expertise_rule_distill');
    expect(params.messages[1].content).toContain('r-rebase · 交付分支必须先 rebase 到 canary');
    expect(options.tracing.scenario).toBe('expertise_rule_distill');
  });

  it('reads a conversation as the reviewer and the assistant, and records it as the topic', async () => {
    findTopic.mockResolvedValue({ id: 'tpc_1', title: '首页评审' });
    transcript.mockResolvedValue({
      items: [
        { content: '空状态要给下一步动作', role: 'user' },
        { content: '好的，我来改', role: 'assistant' },
        { content: '{"tool":true}', role: 'tool' },
      ],
      total: 3,
    });
    generateObject.mockResolvedValue({ rules: [] });

    const result = await service().distillRules({
      groups,
      rules,
      source: { id: 'tpc_1', type: 'topic' },
    });

    expect(result.material).toMatchObject({
      subjectId: 'tpc_1',
      subjectType: 'topic',
      title: '首页评审',
    });
    const content = generateObject.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain('Reviewer: 空状态要给下一步动作');
    expect(content).toContain('Assistant: 好的，我来改');
    expect(content).not.toContain('"tool"');
  });

  it('records a file as the document it was parsed into', async () => {
    parseFile.mockResolvedValue({ content: '规范正文', filename: 'guide.pdf', id: 'docs_parsed' });
    generateObject.mockResolvedValue({ rules: [] });

    const result = await service().distillRules({
      groups,
      rules,
      source: { id: 'file_1', type: 'file' },
    });

    expect(parseFile).toHaveBeenCalledWith('file_1');
    expect(result.material).toMatchObject({
      subjectId: 'docs_parsed',
      subjectType: 'document',
      title: 'guide.pdf',
      type: 'file',
    });
  });

  it('says when the tail of a long material was not read', async () => {
    generateObject.mockResolvedValue({ rules: [] });

    const result = await service().distillRules({
      groups,
      rules,
      source: { text: 'x'.repeat(70_000), type: 'text' },
    });

    expect(result.material.truncated).toBe(true);
  });

  it('keeps a large catalog of existing rules to a bounded slice of the prompt', async () => {
    generateObject.mockResolvedValue({ rules: [candidate({ duplicateOf: 'r-1999' })] });
    const many = Array.from({ length: 2000 }, (_, index) => ({
      id: `r-${index}`,
      title: 'x'.repeat(400),
    }));

    const result = await service().distillRules({
      groups,
      rules: many,
      source: { text: '一条规矩', type: 'text' },
    });

    const [params] = generateObject.mock.calls[0];
    expect(params.messages[1].content.length).toBeLessThan(40_000);
    expect(params.messages[1].content).toContain('r-0 · ');
    // A rule the model was never shown cannot be what a candidate restates.
    expect(result.candidates[0].duplicateOf).toBeNull();
  });

  it('refuses an oversized catalog before reading the material', () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => ({
      gate: 'g',
      id: `g-${index}`,
      title: 't',
    }));
    expect(
      DistillRulesInputSchema.safeParse({
        groups: tooMany,
        rules,
        source: { text: 'x', type: 'text' },
      }).success,
    ).toBe(false);
    expect(
      DistillRulesInputSchema.safeParse({
        groups,
        rules: [{ id: 'r', title: 'x'.repeat(501) }],
        source: { text: 'x', type: 'text' },
      }).success,
    ).toBe(false);
  });

  it('refuses a material with no readable text instead of asking the model', async () => {
    findDocument.mockResolvedValue({ content: '   ', id: 'docs_empty', title: '空文稿' });

    await expect(
      service().distillRules({ groups, rules, source: { id: 'docs_empty', type: 'document' } }),
    ).rejects.toThrow('no readable text');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it.each([
    ['document', 'docs_restricted'],
    ['file', 'file_restricted'],
  ] as const)(
    'refuses a %s in a knowledge base the member has no access to, before reading it',
    async (type, id) => {
      assertContentsNotInRestrictedKnowledgeBase.mockRejectedValue(
        new Error('Only knowledge base managers can view this file'),
      );

      await expect(
        new ExpertiseRuleDistillService({} as never, 'user_1', 'ws_1').distillRules({
          groups,
          rules,
          source: { id, type },
        }),
      ).rejects.toThrow('Only knowledge base managers');
      expect(assertContentsNotInRestrictedKnowledgeBase).toHaveBeenCalledWith(
        { serverDB: {}, userId: 'user_1', workspaceId: 'ws_1' },
        [id],
      );
      expect(findDocument).not.toHaveBeenCalled();
      expect(parseFile).not.toHaveBeenCalled();
      expect(generateObject).not.toHaveBeenCalled();
    },
  );
});
