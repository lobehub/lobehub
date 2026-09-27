import { isServerDefaultHeterogeneousProfileModel } from './serverDefault';

/** Capability metadata is a candidate filter, never proof of a successful CLI run. */
export interface KimiModelCandidate {
  abilities?: { functionCall?: boolean };
  agentCompatibility?: { serverDefaultHeterogeneousProfiles?: string[] };
}

export type KimiModelCompatibility =
  'untested' | 'toolsUnknown' | 'toolsUnsupported' | 'deploymentExcluded';

export const getKimiModelCompatibility = (
  model: KimiModelCandidate,
  serverDefault = false,
): KimiModelCompatibility => {
  if (model.abilities?.functionCall === false) return 'toolsUnsupported';
  const profiles = model.agentCompatibility?.serverDefaultHeterogeneousProfiles;
  // An explicit deployment restriction remains authoritative. Historical ID lists
  // and positive profile tags do not certify a particular CLI/version/route.
  if (serverDefault && profiles && !profiles.includes('kimi-code/anthropic-v1')) {
    return 'deploymentExcluded';
  }
  return model.abilities?.functionCall === true ? 'untested' : 'toolsUnknown';
};

export const isKimiModelCandidate = (model: KimiModelCandidate, serverDefault = false) => {
  const status = getKimiModelCompatibility(model, serverDefault);
  return status === 'untested' || status === 'toolsUnknown';
};

/** The deployment selects discovery policy; explicit exclusions always win. */
export const isKimiServerDefaultModelSupported = (
  model: KimiModelCandidate & { id: string },
  policy: 'profile-attested' | 'profile-candidate',
) => {
  if (!isKimiModelCandidate(model, true)) return false;
  if (policy === 'profile-candidate') return true;
  const profiles = model.agentCompatibility?.serverDefaultHeterogeneousProfiles;
  return profiles
    ? profiles.includes('kimi-code/anthropic-v1')
    : isServerDefaultHeterogeneousProfileModel('kimi-code/anthropic-v1', model.id);
};
