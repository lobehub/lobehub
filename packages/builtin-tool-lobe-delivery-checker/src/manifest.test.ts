import { verifyEvidenceTypes } from '@lobechat/const/verify';
import { describe, expect, it } from 'vitest';

import { LobeDeliveryCheckerManifest } from './manifest';

/** Walk the manifest schema for the requiredEvidence `type` enum. */
const evidenceTypeEnum = (): string[] => {
  const api = LobeDeliveryCheckerManifest.api.find((a) => a.name === 'generateVerifyPlan');
  const criteria = (api?.parameters?.properties as any)?.criteria;
  return criteria?.items?.properties?.requiredEvidence?.items?.properties?.type?.enum ?? [];
};

describe('generateVerifyPlan manifest schema', () => {
  it('accepts every evidence medium the verify pipeline knows', () => {
    // Regression: the systemRole told the model to require `audio` for sound
    // deliverables while this enum still rejected it — argument validation
    // killed the plan before the audio-aware server runtime was ever reached.
    expect(evidenceTypeEnum()).toEqual([...verifyEvidenceTypes]);
  });
});
