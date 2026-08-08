import type { VerifyCheckItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { planEvidenceVerification } from '../evidencePlanner';

const item = (requiredEvidence: unknown[]): VerifyCheckItem =>
  ({
    id: 'check-1',
    index: 0,
    onFail: 'manual',
    required: true,
    title: 'check',
    verifierConfig: { requiredEvidence },
    verifierType: 'llm',
  }) as VerifyCheckItem;

describe('planEvidenceVerification', () => {
  it('uses a multimodal judge for image evidence only when the model has vision', () => {
    const check = item([{ modality: 'image', scope: 'run_evidence', type: 'screenshot' }]);
    expect(
      planEvidenceVerification({
        evidence: [{ fileId: 'file-1', type: 'screenshot' }],
        item: check,
        modelSupportsVision: true,
      }).route,
    ).toBe('llm_multimodal');
    expect(
      planEvidenceVerification({
        evidence: [{ fileId: 'file-1', type: 'screenshot' }],
        item: check,
        modelSupportsVision: false,
      }).route,
    ).toBe('agent');
  });

  it('forces an agent for documents, task artifacts, and mixed modalities', () => {
    for (const check of [
      item([{ modality: 'document', scope: 'deliverable', type: 'markdown' }]),
      item([{ modality: 'text', scope: 'task_artifacts', type: 'text' }]),
      item([
        { modality: 'image', scope: 'run_evidence', type: 'screenshot' },
        { modality: 'text', scope: 'run_evidence', type: 'dom_snapshot' },
      ]),
    ]) {
      expect(
        planEvidenceVerification({ evidence: [], item: check, modelSupportsVision: true }).route,
      ).toBe('agent');
    }
  });

  it('forces an agent to resolve deliverable-scoped evidence even when it is text', () => {
    expect(
      planEvidenceVerification({
        evidence: [],
        item: item([{ modality: 'text', scope: 'deliverable', type: 'markdown' }]),
        modelSupportsVision: true,
      }).route,
    ).toBe('agent');
  });

  it.each(['text', 'markdown', 'dom_snapshot', 'transcript'] as const)(
    'forces an agent to inspect file-backed %s evidence with no inline content',
    (type) => {
      expect(
        planEvidenceVerification({
          evidence: [{ fileId: 'file-large-text', type }],
          item: item([{ modality: 'text', scope: 'run_evidence', type }]),
          modelSupportsVision: true,
        }).route,
      ).toBe('agent');
    },
  );

  it('keeps file-backed text on the text judge when readable content is also inline', () => {
    expect(
      planEvidenceVerification({
        evidence: [{ content: 'readable text', fileId: 'file-text', type: 'text' }],
        item: item([{ modality: 'text', scope: 'run_evidence', type: 'text' }]),
        modelSupportsVision: true,
      }).route,
    ).toBe('llm_text');
  });
});
