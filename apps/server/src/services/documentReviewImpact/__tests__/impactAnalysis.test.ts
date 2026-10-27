import type { DocumentReviewImpactInput } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { DocumentReviewImpactItem } from '@/database/schemas/documentReview';

import type { DocumentImpactLlm, DocumentImpactLlmRequest } from '../llm';
import type {
  ImpactAnalysisRepository,
  ImpactDocumentRecord,
  ImpactHistoryRecord,
  ImpactSessionRecord,
} from '../repository';
import { DocumentReviewImpactService } from '../service';
import {
  BASELINE_CONTRACT,
  CURRENT_CONTRACT,
  editorDataFromText,
  MOCK_IMPACT_RESPONSE,
} from './fixtures';

class MemoryRepository implements ImpactAnalysisRepository {
  baseline?: ImpactHistoryRecord;
  document?: ImpactDocumentRecord;
  impacts: DocumentReviewImpactItem[] = [];
  session?: ImpactSessionRecord;
  savedBaseline?: string;

  loadSession = async (sessionId: string) =>
    this.session?.id === sessionId ? this.session : undefined;

  loadDocument = async (documentId: string) =>
    this.document?.id === documentId ? this.document : undefined;

  loadBaseline = async (documentId: string, historyId: string) =>
    this.document?.id === documentId && this.baseline?.id === historyId ? this.baseline : undefined;

  saveImpacts = async (sessionId: string, items: DocumentReviewImpactInput[]) => {
    const now = new Date();
    this.impacts = items.map((item, index) => ({
      accessedAt: now,
      category: item.category,
      confidence: item.confidence ?? null,
      createdAt: now,
      id: `impact_${index}`,
      kind: item.kind,
      reason: item.reason,
      relatedAnchor: item.relatedAnchor ?? null,
      sessionId,
      severity: item.severity ?? 'medium',
      sortOrder: index,
      sourceAnchor: item.sourceAnchor ?? null,
      status: 'open' as const,
      title: item.title,
      trigger: item.trigger ?? null,
      updatedAt: now,
      workspaceId: 'ws_test',
    }));
    return this.impacts;
  };

  setBaseline = async (_sessionId: string, historyId: string) => {
    this.savedBaseline = historyId;
  };

  findImpact = async (impactId: string) => this.impacts.find((impact) => impact.id === impactId);
}

class ScriptedLlm implements DocumentImpactLlm {
  requests: DocumentImpactLlmRequest[] = [];

  constructor(private readonly respond: () => unknown) {}

  generateObject = async (request: DocumentImpactLlmRequest) => {
    this.requests.push(request);
    return this.respond();
  };
}

const buildService = (
  overrides: {
    baselineContract?: string;
    currentContract?: string;
    respond?: () => unknown;
    session?: Partial<ImpactSessionRecord>;
  } = {},
) => {
  const repository = new MemoryRepository();
  repository.session = {
    baseHistoryId: 'hist_base',
    documentId: 'doc_1',
    id: 'drs_session',
    title: '采购合同审阅',
    ...overrides.session,
  };
  repository.document = {
    content: null,
    editorData: editorDataFromText(overrides.currentContract ?? CURRENT_CONTRACT),
    id: 'doc_1',
    title: '技术服务采购合同',
  };
  repository.baseline = {
    editorData: editorDataFromText(overrides.baselineContract ?? BASELINE_CONTRACT),
    id: 'hist_base',
    savedAt: new Date('2026-10-01T08:00:00Z'),
  };
  const llm = new ScriptedLlm(overrides.respond ?? (() => MOCK_IMPACT_RESPONSE));

  return {
    llm,
    repository,
    service: new DocumentReviewImpactService({ llm, repository }),
  };
};

describe('DocumentReviewImpactService', () => {
  it('diffs the baseline, anchors every quote and persists the items', async () => {
    const { llm, repository, service } = buildService();

    const result = await service.analyze({ sessionId: 'drs_session' });

    // Direct textual differences come from the real diff, not the model.
    expect(result.diff.blocks).toHaveLength(1);
    expect(result.diff.blocks[0].before).toContain('乙方应完成全部交付物');
    expect(result.diff.blocks[0].after).toContain('分阶段验收');

    expect(result.stats).toMatchObject({
      dropped: 0,
      invalidAnchors: 1,
      locatedAnchors: 10,
      semantic: 5,
      textual: 1,
    });
    expect(repository.impacts).toHaveLength(6);

    const [textual, payment, warranty, termination, definition, crossReference] =
      repository.impacts;

    // Direct wording difference.
    expect(textual).toMatchObject({
      category: 'textual',
      confidence: 0.97,
      kind: 'related_clause',
      title: '验收条款修改',
      trigger: '「并经甲方最终验收合格」改为「并经甲方分阶段验收合格」',
    });
    expect(textual.sourceAnchor).toMatchObject({
      quote: '并经甲方分阶段验收合格',
      label: '第 2 条 交付',
    });
    expect(textual.sourceAnchor?.start).toBeGreaterThan(0);
    expect(textual.sourceAnchor?.prefix).toContain('乙方应按附件一约定的阶段完成交付物');
    expect(textual.sourceAnchor?.suffix).toContain('第 3 条 付款');

    // Semantic impacts on text that did not change.
    expect(payment).toMatchObject({ category: 'semantic', title: '付款触发条件' });
    expect(payment.relatedAnchor?.quote).toBe(
      '甲方在最终验收合格后 10 个工作日内支付合同价款的 90%',
    );
    expect(payment.relatedAnchor?.invalid).toBeUndefined();
    expect(payment.sourceAnchor?.quote).toBe('分阶段验收');
    expect(payment.confidence).toBeCloseTo(0.94);

    expect(warranty.relatedAnchor?.quote).toBe('质保期自最终验收合格之日起 12 个月');
    expect(termination.relatedAnchor?.quote).toBe(
      '乙方应在最终验收合格后 10 个工作日内交付全部工作成果及资料',
    );
    expect(definition.kind).toBe('definition');

    // Unlocatable anchor: kept with `invalid`, not dropped.
    expect(crossReference.title).toBe('附件二交叉引用');
    expect(crossReference.relatedAnchor).toMatchObject({
      invalid: true,
      quote: '附件二第三条约定最终验收的组织方式',
    });

    // The prompt carried the diff and the checklist that names the three obligations.
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]).toMatchObject({
      promptVersion: 'v1',
      scenario: 'document_review_impact',
      schemaName: 'document_review_impacts',
    });
    expect(llm.requests[0].user).toContain('直接文字差异（基线 → 当前）');
    expect(llm.requests[0].user).toContain('- 乙方应完成全部交付物，并经甲方最终验收合格。');
    expect(llm.requests[0].user).toContain(
      '+ 乙方应按附件一约定的阶段完成交付物，并经甲方分阶段验收合格。',
    );
    expect(llm.requests[0].system).toContain('payment, warranty start, delivery or termination');
  });

  it('pins a baseline passed to the run on the session', async () => {
    const { repository, service } = buildService({ session: { baseHistoryId: null } });

    await expect(service.analyze({ sessionId: 'drs_session' })).rejects.toMatchObject({
      code: 'NO_BASELINE',
    });

    const baseline = repository.baseline!;
    const result = await service.analyze({ baseHistoryId: baseline.id, sessionId: 'drs_session' });

    expect(result.items).toHaveLength(6);
    expect(repository.savedBaseline).toBe('hist_base');
  });

  it('reports no difference between identical versions instead of an empty list', async () => {
    const { service } = buildService({ baselineContract: CURRENT_CONTRACT });

    await expect(service.analyze({ sessionId: 'drs_session' })).rejects.toMatchObject({
      code: 'NO_DIFF',
    });
  });

  it('reports a missing baseline row', async () => {
    const { service } = buildService({ session: { baseHistoryId: 'hist_missing' } });

    await expect(service.analyze({ sessionId: 'drs_session' })).rejects.toMatchObject({
      code: 'BASELINE_NOT_FOUND',
    });
  });

  it('wraps a model failure as LLM_FAILED', async () => {
    const { service } = buildService({
      respond: () => {
        throw new Error('provider timeout');
      },
    });

    await expect(service.analyze({ sessionId: 'drs_session' })).rejects.toMatchObject({
      code: 'LLM_FAILED',
      details: { cause: 'provider timeout' },
    });
  });

  it('rejects off-schema output and keeps the partial items that are valid', async () => {
    const invalidOnly = buildService({
      respond: () => ({ items: [{ confidence: 2, kind: 'nope', title: '' }] }),
    });
    await expect(invalidOnly.service.analyze({ sessionId: 'drs_session' })).rejects.toMatchObject({
      code: 'SCHEMA_INVALID',
    });

    const partial = buildService({
      respond: () => ({
        items: [MOCK_IMPACT_RESPONSE.items[0], { kind: 'obligation', title: '缺少原文' }],
      }),
    });
    const result = await partial.service.analyze({ sessionId: 'drs_session' });

    expect(result.stats.dropped).toBe(1);
    expect(result.items.map((item) => item.title)).toEqual(['验收条款修改']);
  });

  it('assembles the follow-up context from the impact and both excerpts', async () => {
    const { repository, service } = buildService();
    await service.analyze({ sessionId: 'drs_session' });
    const payment = repository.impacts[1];

    const context = await service.buildFollowUpContext({
      impactId: payment.id,
      question: '付款节点应该怎么改？',
    });

    expect(context.document).toMatchObject({ title: '技术服务采购合同' });
    expect(context.impact.title).toBe('付款触发条件');
    expect(context.source).toMatchObject({
      anchor: { quote: '分阶段验收' },
      quote: '分阶段验收',
      status: 'located',
    });
    expect(context.related).toMatchObject({
      quote: '甲方在最终验收合格后 10 个工作日内支付合同价款的 90%',
      status: 'located',
    });
    expect(context.related?.before).toContain('第 3 条 付款');
    expect(context.messages[1].content).toContain('付款节点应该怎么改？');
    expect(context.messages[1].content).toContain('判断依据: 付款仍以「最终验收合格」为触发条件');
    expect(context.messages[1].content).toContain(
      '原文: "甲方在最终验收合格后 10 个工作日内支付合同价款的 90%"',
    );
  });

  it('keeps an invalid anchor visible in the follow-up context', async () => {
    const { repository, service } = buildService();
    await service.analyze({ sessionId: 'drs_session' });
    const crossReference = repository.impacts[5];

    const context = await service.buildFollowUpContext({ impactId: crossReference.id });

    expect(context.related).toMatchObject({
      quote: '附件二第三条约定最终验收的组织方式',
      status: 'invalid',
    });
    expect(context.messages[1].content).toContain('状态: invalid');
  });
});
