import { describe, expect, it } from 'vitest';

import {
  getKimiModelCompatibility,
  isKimiModelCandidate,
  isKimiServerDefaultModelSupported,
} from './modelCompatibility';

describe('Kimi model candidates', () => {
  it('does not infer verification from tools or an attestation', () => {
    expect(getKimiModelCompatibility({ abilities: { functionCall: true } })).toBe('untested');
    expect(
      getKimiModelCompatibility(
        {
          abilities: { functionCall: true },
          agentCompatibility: { serverDefaultHeterogeneousProfiles: ['kimi-code/anthropic-v1'] },
        },
        true,
      ),
    ).toBe('untested');
  });
  it('allows missing metadata as explicitly unknown, not verified', () => {
    expect(getKimiModelCompatibility({})).toBe('toolsUnknown');
    expect(isKimiModelCandidate({})).toBe(true);
  });
  it('rejects explicit lack of tool support even when the deployment attests a model', () => {
    expect(
      isKimiModelCandidate(
        {
          abilities: { functionCall: false },
          agentCompatibility: { serverDefaultHeterogeneousProfiles: ['kimi-code/anthropic-v1'] },
        },
        true,
      ),
    ).toBe(false);
  });
  it('honors explicit exclusions only on the server-default route', () => {
    const model = {
      abilities: { functionCall: true },
      agentCompatibility: { serverDefaultHeterogeneousProfiles: [] },
    };
    expect(getKimiModelCompatibility(model, true)).toBe('deploymentExcluded');
    expect(isKimiModelCandidate(model, true)).toBe(false);
    expect(isKimiModelCandidate(model)).toBe(true);
  });
});

describe('Kimi server-default deployment policy', () => {
  it('keeps the attested default and lets a deployment opt into new catalog models', () => {
    const model = { id: 'deployment-new-model', abilities: { functionCall: true } };
    expect(isKimiServerDefaultModelSupported(model, 'profile-attested')).toBe(false);
    expect(isKimiServerDefaultModelSupported(model, 'profile-candidate')).toBe(true);
    expect(isKimiServerDefaultModelSupported({ id: 'kimi-k3' }, 'profile-attested')).toBe(true);
    expect(
      isKimiServerDefaultModelSupported({ id: 'deployment-unknown-tools' }, 'profile-candidate'),
    ).toBe(true);
  });

  it.each(['profile-attested', 'profile-candidate'] as const)(
    'preserves explicit metadata under %s',
    (policy) => {
      const model = { id: 'deployment-new-model', abilities: { functionCall: true } };
      expect(
        isKimiServerDefaultModelSupported(
          {
            ...model,
            agentCompatibility: { serverDefaultHeterogeneousProfiles: ['kimi-code/anthropic-v1'] },
          },
          policy,
        ),
      ).toBe(true);
      expect(
        isKimiServerDefaultModelSupported(
          { ...model, agentCompatibility: { serverDefaultHeterogeneousProfiles: [] } },
          policy,
        ),
      ).toBe(false);
      expect(
        isKimiServerDefaultModelSupported(
          { id: 'kimi-k3', abilities: { functionCall: false } },
          policy,
        ),
      ).toBe(false);
    },
  );
});
