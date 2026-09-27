/** Capability metadata is a candidate filter, never proof of a successful CLI run. */
export interface KimiModelCandidate {
  abilities?: { functionCall?: boolean };
}

export type KimiModelCompatibility = 'untested' | 'toolsUnknown' | 'toolsUnsupported';

export const getKimiModelCompatibility = (model: KimiModelCandidate): KimiModelCompatibility => {
  if (model.abilities?.functionCall === false) return 'toolsUnsupported';
  return model.abilities?.functionCall === true ? 'untested' : 'toolsUnknown';
};

export const isKimiModelCandidate = (model: KimiModelCandidate) => {
  const status = getKimiModelCompatibility(model);
  return status === 'untested' || status === 'toolsUnknown';
};
