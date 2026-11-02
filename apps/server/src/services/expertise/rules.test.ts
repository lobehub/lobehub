// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftRuleInputSchema, ExpertiseRuleDraftService } from './rules';

const { fillLessonDirections, listRules, resolveExpertiseModelConfig } = vi.hoisted(() => ({
  fillLessonDirections: vi.fn(),
  listRules: vi.fn(),
  resolveExpertiseModelConfig: vi.fn(),
}));
const generateObject = vi.fn();

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = generateObject;
  },
}));
vi.mock('./modelConfig', () => ({ resolveExpertiseModelConfig }));
vi.mock('@/database/models/expertise', () => ({
  ExpertiseModel: class {
    fillLessonDirections = fillLessonDirections;
    listRules = listRules;
  },
}));

const groups = [
  { gate: '去掉页面名之后还成立吗？', id: 'g-taste', title: '我的交付审美' },
  { gate: '换一个仓库还成立吗？', id: 'g-design', title: '设计体系' },
];

describe('ExpertiseRuleDraftService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveExpertiseModelConfig.mockResolvedValue({ model: 'm', provider: 'p' });
  });

  it('drafts one rule and keeps a group id only when the reviewer has that group', async () => {
    generateObject.mockResolvedValue({
      compilability: 'compilable',
      direction: 'positive',
      enforcement: 'block',
      groupId: 'g-design',
      how: '  样式里出现 #fff 或 12px  ',
      limits: null,
      newGroup: { gate: 'x', title: 'y' },
      title: '颜色、间距、圆角一律取自设计系统变量',
      why: '',
    });

    const draft = await new ExpertiseRuleDraftService({} as never, 'user_1').draftRule({
      brief: '你应该用 cssVar 的吧',
      groups,
    });

    expect(draft).toEqual({
      compilability: 'compilable',
      direction: 'positive',
      enforcement: 'block',
      groupId: 'g-design',
      how: '样式里出现 #fff 或 12px',
      limits: null,
      // A matched group wins over a proposed one; both would be confusing.
      newGroup: null,
      title: '颜色、间距、圆角一律取自设计系统变量',
      why: null,
    });
    const [params, options] = generateObject.mock.calls[0];
    expect(params.schema.name).toBe('expertise_rule_draft');
    expect(params.messages[1].content).toContain('g-design · 设计体系 · 换一个仓库还成立吗？');
    expect(options.tracing.scenario).toBe('expertise_rule_draft');
  });

  it('drops a group id the reviewer does not have and keeps the proposed group', async () => {
    generateObject.mockResolvedValue({
      compilability: 'not-compilable',
      direction: 'negative',
      enforcement: 'remind',
      groupId: 'g-invented',
      how: null,
      limits: null,
      newGroup: { gate: '这条只对 lobehub 成立吗？', title: 'OSS 工程规范' },
      title: '交付分支必须先 rebase 到 canary',
      why: null,
    });

    const draft = await new ExpertiseRuleDraftService({} as never, 'user_1').draftRule({
      brief: '你先 rebase 一下再截',
      groups,
    });

    expect(draft.groupId).toBeNull();
    expect(draft.newGroup).toEqual({ gate: '这条只对 lobehub 成立吗？', title: 'OSS 工程规范' });
  });

  it('never hands back a draft that claims to be compiled already', async () => {
    generateObject.mockResolvedValue({
      compilability: 'compiled',
      direction: 'positive',
      enforcement: 'remind',
      groupId: 'g-design',
      how: null,
      limits: null,
      newGroup: null,
      title: '颜色一律取自设计系统变量',
      why: null,
    });

    const draft = await new ExpertiseRuleDraftService({} as never, 'user_1').draftRule({
      brief: '你应该用 cssVar 的吧',
      groups,
    });

    // Only the compiler can make a rule `compiled`, by linking a criterion.
    expect(draft.compilability).toBe('compilable');
  });

  it('drafts a group as a name and a gate question', async () => {
    generateObject.mockResolvedValue({
      gate: '这条只对 lobehub 这个仓库成立，还是对任何仓库都成立？',
      outOfScope: null,
      title: 'OSS 工程规范',
    });

    const draft = await new ExpertiseRuleDraftService({} as never, 'user_1').draftRuleGroup({
      brief: '开源仓库的工程要求',
    });

    expect(draft.title).toBe('OSS 工程规范');
    expect(generateObject.mock.calls[0][1].tracing.scenario).toBe('expertise_rule_group_draft');
  });

  it('accepts a scope with more groups than a page used to fit', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      gate: `守门题 ${i}`,
      id: `g-${i}`,
      title: `分组 ${i}`,
    }));
    expect(DraftRuleInputSchema.safeParse({ brief: '颜色取自变量', groups: many }).success).toBe(
      true,
    );
  });
});

describe('ExpertiseRuleDraftService.judgeDirections', () => {
  const rule = (id: string, extra: Record<string, unknown> = {}) => ({
    direction: null,
    id,
    status: 'active',
    title: `规矩 ${id}`,
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resolveExpertiseModelConfig.mockResolvedValue({ model: 'm', provider: 'p' });
  });

  it('judges only the named active rules without a direction and writes the answers', async () => {
    listRules.mockResolvedValue([
      {
        rules: [
          rule('a'),
          rule('b', { direction: 'negative' }),
          rule('c', { status: 'retired' }),
          rule('d'),
          // Unjudged but not in this batch: left for a later call.
          rule('e'),
        ],
      },
    ]);
    generateObject.mockResolvedValue({
      rules: [
        { direction: 'positive', id: 'a' },
        { direction: 'negative', id: 'd' },
      ],
    });

    const result = await new ExpertiseRuleDraftService({} as never, 'user_1').judgeDirections([
      'a',
      'b',
      'c',
      'd',
    ]);

    const [params, options] = generateObject.mock.calls[0];
    expect(params.schema.name).toBe('expertise_rule_direction');
    expect(params.messages[1].content).toBe('- a · 规矩 a\n- d · 规矩 d');
    expect(options.tracing.scenario).toBe('expertise_rule_direction');
    expect(fillLessonDirections).toHaveBeenCalledWith([
      { direction: 'positive', id: 'a' },
      { direction: 'negative', id: 'd' },
    ]);
    expect(result).toEqual({ judged: 2 });
  });

  it('drops ids outside the batch and repeated answers', async () => {
    listRules.mockResolvedValue([{ rules: [rule('a'), rule('b')] }]);
    generateObject.mockResolvedValue({
      rules: [
        { direction: 'positive', id: 'a' },
        { direction: 'negative', id: 'a' },
        { direction: 'negative', id: 'someone-else' },
      ],
    });

    const result = await new ExpertiseRuleDraftService({} as never, 'user_1').judgeDirections([
      'a',
      'b',
    ]);

    expect(fillLessonDirections).toHaveBeenCalledWith([{ direction: 'positive', id: 'a' }]);
    expect(result).toEqual({ judged: 1 });
  });

  it('does not call the model when every rule already has a direction', async () => {
    listRules.mockResolvedValue([{ rules: [rule('a', { direction: 'positive' })] }]);

    const result = await new ExpertiseRuleDraftService({} as never, 'user_1').judgeDirections([
      'a',
      'not-on-this-page',
    ]);

    expect(generateObject).not.toHaveBeenCalled();
    expect(result).toEqual({ judged: 0 });
  });
});
