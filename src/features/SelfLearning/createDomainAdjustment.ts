import type { ExpertiseDomainDraft } from '@/services/expertise';

export type AdjustmentTarget =
  'canonEntries' | 'domainFilter' | 'layers' | 'outOfScope' | 'rationale';

export const mergeAdjustedBlock = (
  current: ExpertiseDomainDraft,
  adjusted: ExpertiseDomainDraft,
  target: AdjustmentTarget,
): ExpertiseDomainDraft => ({ ...current, [target]: adjusted[target] });
