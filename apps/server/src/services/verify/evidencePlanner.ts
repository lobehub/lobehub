import type { JudgeEvidence } from '@lobechat/prompts';
import type { RequiredEvidenceSpec, VerifyCheckItem } from '@lobechat/types';

import { readRequiredEvidence } from './evidenceCoverage';

export type JudgeRoute = 'agent' | 'llm_multimodal' | 'llm_text';

export interface EvidencePlan {
  modalities: Set<NonNullable<RequiredEvidenceSpec['modality']>>;
  route: JudgeRoute;
}

const imageEvidenceTypes = new Set(['gif', 'screenshot']);
const textEvidenceTypes = new Set(['dom_snapshot', 'markdown', 'text', 'transcript']);

/**
 * Select the least-powerful verifier that can inspect every required artifact.
 * Heterogeneous, document, audio, video, and task-artifact checks always require
 * an agent; a pure image check may use an inline judge only when the model has vision.
 */
export const planEvidenceVerification = (params: {
  evidence: JudgeEvidence[];
  item: VerifyCheckItem;
  modelSupportsVision: boolean;
}): EvidencePlan => {
  const required = readRequiredEvidence(params.item.verifierConfig) ?? [];
  const modalities = new Set(
    required
      .map((spec) => spec.modality)
      .filter((modality): modality is NonNullable<RequiredEvidenceSpec['modality']> =>
        Boolean(modality),
      ),
  );
  const evidenceTypes = new Set([
    ...required.map((spec) => spec.type),
    ...params.evidence.map((item) => item.type),
  ]);
  const scopes = new Set(required.map((spec) => spec.scope).filter(Boolean));
  const hasFileBackedText = params.evidence.some(
    (evidence) =>
      textEvidenceTypes.has(evidence.type) && Boolean(evidence.fileId) && !evidence.content,
  );

  if (
    scopes.has('deliverable') ||
    scopes.has('task_artifacts') ||
    hasFileBackedText ||
    modalities.has('audio') ||
    modalities.has('document') ||
    modalities.has('video') ||
    modalities.size > 1 ||
    [...evidenceTypes].some((type) => !imageEvidenceTypes.has(type) && !textEvidenceTypes.has(type))
  ) {
    return { modalities, route: 'agent' };
  }

  const hasImage =
    modalities.has('image') || [...evidenceTypes].some((type) => imageEvidenceTypes.has(type));
  if (hasImage) {
    return { modalities, route: params.modelSupportsVision ? 'llm_multimodal' : 'agent' };
  }

  return { modalities, route: 'llm_text' };
};
