// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExpertiseConsolidationService, resolveLimits } from './consolidation';

const { resolveExpertiseModelConfig } = vi.hoisted(() => ({
  resolveExpertiseModelConfig: vi.fn().mockResolvedValue({ model: 'm', provider: 'p' }),
}));
const generateObject = vi.fn();
const listByCheckResult = vi.fn().mockResolvedValue([]);

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = generateObject;
  },
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: class {
    listByCheckResult = listByCheckResult;
  },
}));
vi.mock('@/database/models/file', () => ({
  FileModel: class {
    findById = vi.fn().mockResolvedValue(null);
  },
}));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./modelConfig', () => ({ resolveExpertiseModelConfig }));

const LESSON = {
  code: 'P-07',
  domainId: 'domain_1',
  id: 'lesson_1',
  reasonKind: 'taste',
  sections: [
    { body: '输入框内部工具栏不应添加多余的分隔线', key: 'rule' },
    { body: '分割线破坏容器整体性', key: 'why' },
    { body: '评论输入框底部多了一条横线', key: 'how' },
  ],
  title: '输入框内部工具栏不应添加多余的分隔线',
};

const instance = (id: string, comment: string) => ({
  detail: {
    annotations: [
      { comment, evidenceId: `ev_${id}`, rect: { height: 0.1, width: 0.2, x: 0.1, y: 0.2 } },
    ],
  },
  example: `多了一条线（${id}）`,
  id,
  title: `check ${id}`,
});

/**
 * A boundary fake for the reads `consolidate` makes, in order: the lesson row, its instances, the
 * accepted deliveries, then — inside the transaction — the latest revision number. `inserts` and
 * `updates` capture what would be written.
 */
const createDb = (
  instances: unknown[],
  shipped: unknown[] = [],
  priorRevision = 0,
  lesson: typeof LESSON = LESSON,
) => {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const results: unknown[][] = [
    [lesson],
    instances,
    shipped,
    priorRevision > 0 ? [{ revision: priorRevision }] : [],
  ];
  let index = 0;

  const chain = (): Record<string, unknown> => {
    const value = results[index++] ?? [];
    const self: Record<string, unknown> = {
      as: () => self,
      from: () => self,
      groupBy: () => self,
      innerJoin: () => self,
      leftJoin: () => self,
      limit: () => self,
      orderBy: () => self,
      // eslint-disable-next-line unicorn/no-thenable
      then: (resolve: (v: unknown) => void) => resolve(value),
      where: () => self,
    };
    return self;
  };

  const db: Record<string, unknown> = {
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        inserts.push(value);
      },
    }),
    select: chain,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          updates.push(value);
        },
      }),
    }),
  };

  return { db: db as never, inserts, updates };
};

afterEach(() => {
  vi.clearAllMocks();
  generateObject.mockReset();
});

describe('ExpertiseConsolidationService.consolidate', () => {
  it('restates the standard at the level its instances share and keeps the wording it replaced', async () => {
    const { db, inserts, updates } = createDb([
      instance('c1', '这里多了没必要的一条'),
      instance('c2', '这个卡片间的分割线去掉'),
      instance('c3', '表格头下面这条线不要'),
    ]);
    generateObject.mockResolvedValue({
      currentLimitsArePlaceholder: true,
      generalized: true,
      limits: [],
      note: 'I1–I3 都是未被要求的分隔线',
      reasonKind: 'taste',
      reasoning: '分隔线与留白表达同一件事，重复的边界让人多读一层结构',
      subject: '未被要求的分隔装饰',
      title: '不要添加未被要求的分隔线，区域之间只靠留白与容器边界区分',
    });

    const result = await new ExpertiseConsolidationService(db, 'user_1').consolidate('lesson_1');

    expect(result.generalized).toBe(true);
    expect(updates[0].title).toBe('不要添加未被要求的分隔线，区域之间只靠留白与容器边界区分');
    const sections = updates[0].sections as { body: string; key: string }[];
    expect(sections.find((section) => section.key === 'rule')?.body).toContain(
      '适用对象：未被要求的分隔装饰',
    );
    // The worked example has no better source than the one already on the lesson, so it survives.
    expect(sections.find((section) => section.key === 'how')?.body).toBe(
      '评论输入框底部多了一条横线',
    );
    expect(inserts[0]).toMatchObject({
      changedBy: 'system',
      evidence: { boundaries: [], instances: ['c1', 'c2', 'c3'], shipped: [] },
      kind: 'generalize',
      prevTitle: '输入框内部工具栏不应添加多余的分隔线',
      revision: 1,
    });
  });

  it('leaves the standard alone when the instances do not share one, but still records the pass', async () => {
    const { db, inserts, updates } = createDb([
      instance('c1', '状态应该放在标题边上'),
      instance('c2', '话题放到助理档案上方去'),
      instance('c3', '这两个我觉得应该并排放'),
    ]);
    generateObject.mockResolvedValue({
      currentLimitsArePlaceholder: true,
      generalized: false,
      limits: [],
      note: '三条都是位置问题，但不是同一条标准',
      reasonKind: 'taste',
      reasoning: '',
      subject: '',
      title: '',
    });

    const result = await new ExpertiseConsolidationService(db, 'user_1').consolidate('lesson_1');

    expect(result).toMatchObject({ generalized: false, reason: 'nothing-new' });
    // Nothing is rewritten — the only write is the revision counter moving with the logged pass,
    // which a refusal still records, or the same instances get re-read every round.
    expect(updates).toEqual([{ currentRevision: 1 }]);
    // …and records what it looked at, so "not one standard" can be checked against the same rows.
    expect(inserts[0]).toMatchObject({
      evidence: { instances: ['c1', 'c2', 'c3'] },
      kind: 'generalize',
      prevTitle: LESSON.title,
    });
  });

  it('stores which accepted delivery each boundary was read from, and drops the ones that name none', async () => {
    const { db, inserts, updates } = createDb(
      [instance('c1', 'a'), instance('c2', 'b'), instance('c3', 'c')],
      [
        { detail: null, example: null, id: 'ok_menu', title: 'menu' },
        { detail: null, example: null, id: 'ok_table', title: 'table' },
      ],
    );
    generateObject.mockResolvedValue({
      currentLimitsArePlaceholder: true,
      generalized: true,
      limits: [
        {
          shippedRefs: ['S1'],
          text: '下拉菜单里隔离危险操作的分隔线不受此限',
        },
        // Cites nothing the reviewer shipped — an invented exemption.
        { shippedRefs: [], text: '卡片内部的分隔线不受此限' },
        // Cites a rejected instance, which can never justify an exemption.
        { shippedRefs: ['I2'], text: '表单里的分隔线不受此限' },
      ],
      note: '',
      reasonKind: 'mechanism',
      reasoning: 'r',
      subject: 's',
      title: 't',
    });

    await new ExpertiseConsolidationService(db, 'user_1').consolidate('lesson_1');

    const sections = updates[0].sections as { body: string; key: string }[];
    expect(sections.find((section) => section.key === 'limits')?.body).toBe(
      '下拉菜单里隔离危险操作的分隔线不受此限',
    );
    expect(inserts[0].evidence).toEqual({
      boundaries: [
        { checkResultIds: ['ok_menu'], limit: '下拉菜单里隔离危险操作的分隔线不受此限' },
      ],
      instances: ['c1', 'c2', 'c3'],
      shipped: ['ok_menu', 'ok_table'],
    });
  });

  it('keeps the limits the standard already had when the pass adds none', async () => {
    const stated = '表格表头下方的线不受此限';
    const { db, updates } = createDb(
      [instance('c1', 'a'), instance('c2', 'b'), instance('c3', 'c')],
      [],
      0,
      { ...LESSON, sections: [...LESSON.sections, { body: stated, key: 'limits' }] },
    );
    generateObject.mockResolvedValue({
      currentLimitsArePlaceholder: true,
      generalized: true,
      limits: [],
      note: '',
      reasonKind: 'taste',
      reasoning: 'r',
      subject: 's',
      title: 't',
    });

    await new ExpertiseConsolidationService(db, 'user_1').consolidate('lesson_1');

    // Dropping a boundary the reviewer stated widens the standard past what they said.
    const sections = updates[0].sections as { body: string; key: string }[];
    expect(sections.find((section) => section.key === 'limits')?.body).toBe(stated);
  });

  it('will not promote a taste standard to a mechanism', async () => {
    // LESSON is taste. Replaying the same group twice returned both answers, so an upgrade here is
    // model noise arming the compile gate with a mechanism the reviewer never gave.
    const { db, updates } = createDb([
      instance('c1', 'a'),
      instance('c2', 'b'),
      instance('c3', 'c'),
    ]);
    generateObject.mockResolvedValue({
      currentLimitsArePlaceholder: true,
      generalized: true,
      limits: [],
      note: '',
      reasonKind: 'mechanism',
      reasoning: 'r',
      subject: 's',
      title: 't',
    });

    await new ExpertiseConsolidationService(db, 'user_1').consolidate('lesson_1');

    expect(updates[0].reasonKind).toBe('taste');
  });

  it('lets a mechanism standard admit it was taste all along', async () => {
    const { db, updates } = createDb(
      [instance('c1', 'a'), instance('c2', 'b'), instance('c3', 'c')],
      [],
      0,
      { ...LESSON, reasonKind: 'mechanism' },
    );
    generateObject.mockResolvedValue({
      currentLimitsArePlaceholder: true,
      generalized: true,
      limits: [],
      note: '',
      reasonKind: 'taste',
      reasoning: 'r',
      subject: 's',
      title: 't',
    });

    await new ExpertiseConsolidationService(db, 'user_1').consolidate('lesson_1');

    expect(updates[0].reasonKind).toBe('taste');
  });

  it('counts a delivery once even when it backs the standard through several hits', async () => {
    const { db } = createDb([instance('c1', 'a'), instance('c1', 'a again'), instance('c2', 'b')]);

    const result = await new ExpertiseConsolidationService(db, 'user_1').consolidate('lesson_1');

    // Two distinct deliveries is below the threshold, so the pass must not reach the model.
    expect(result.reason).toBe('below-threshold');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('does not call the model for a standard that has fired once', async () => {
    const { db } = createDb([instance('c1', 'a')]);

    const result = await new ExpertiseConsolidationService(db, 'user_1').consolidate('lesson_1');

    expect(result.reason).toBe('below-threshold');
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe('ExpertiseConsolidationService.dueForConsolidation', () => {
  /** Only the aggregate row matters here, so the fake answers one query with whatever it is given. */
  const dueDb = (rows: { id: string; pending: number; total: number }[]) =>
    ({
      select: () => {
        const self: Record<string, unknown> = {
          as: () => self,
          from: () => self,
          groupBy: () => self,
          leftJoin: () => self,
          // eslint-disable-next-line unicorn/no-thenable
          then: (resolve: (v: unknown) => void) => resolve(rows),
          where: () => self,
        };
        return self;
      },
    }) as never;

  it('picks the standards that have taken on instances since they were last restated', async () => {
    const service = new ExpertiseConsolidationService(
      dueDb([
        // Enough instances and one arrived after the last pass.
        { id: 'grown', pending: 1, total: 4 },
        // Consolidated at three and still at three — nothing new to read.
        { id: 'settled', pending: 0, total: 3 },
        // Two rejections can agree on wording by coincidence; three is where it stops being one.
        { id: 'young', pending: 2, total: 2 },
      ]),
      'user_1',
    );

    await expect(service.dueForConsolidation('domain_1')).resolves.toEqual(['grown']);
  });
});

describe('resolveLimits', () => {
  it('keeps every limit the standard already carries, even ones the model never mentions', () => {
    const { texts } = resolveLimits([{ shippedRefs: ['S1'], text: '新的豁免' }], ['ok_1'], {
      isPlaceholder: false,
      text: '表格表头下方的线不受此限\n侧栏分组之间的线不受此限',
    });

    // The reviewer drew these. A pass that had to echo them back to keep them would widen the
    // standard the first time the model forgot one.
    expect(texts).toEqual(['表格表头下方的线不受此限', '侧栏分组之间的线不受此限', '新的豁免']);
  });

  it('drops the "no boundary stated" placeholder only once a real exemption replaces it', () => {
    const placeholder = { isPlaceholder: true, text: '边界未由评审者说明' };

    expect(
      resolveLimits([{ shippedRefs: ['S1'], text: '真的豁免' }], ['ok_1'], placeholder).texts,
    ).toEqual(['真的豁免']);
    // Nothing valid arrived, so the standard keeps the section it had.
    expect(
      resolveLimits([{ shippedRefs: [], text: '编的豁免' }], ['ok_1'], placeholder).texts,
    ).toEqual(['边界未由评审者说明']);
  });

  it('ignores labels that were never listed and does not repeat an id', () => {
    const { boundaries } = resolveLimits(
      [{ shippedRefs: ['S1', 'S1', 'S9'], text: 'x' }],
      ['ok_1'],
      { isPlaceholder: false, text: '' },
    );

    expect(boundaries).toEqual([{ checkResultIds: ['ok_1'], limit: 'x' }]);
  });

  it('does not add a boundary the standard already states', () => {
    const { texts } = resolveLimits(
      [{ shippedRefs: ['S1'], text: '表格表头下方的线  不受此限' }],
      ['ok_1'],
      {
        isPlaceholder: false,
        text: '表格表头下方的线不受此限',
      },
    );

    expect(texts).toEqual(['表格表头下方的线不受此限']);
  });
});
