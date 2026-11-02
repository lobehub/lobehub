import type {
  OnDemandCapabilityFailure,
  OnDemandCapabilityLoadRequest,
  OnDemandCapabilityValidationResult,
} from '@lobechat/types';

import { validateAtomicCapabilityBundle } from './bundleValidator';
import type { AtomicCapabilityRegistry } from './registry';

const notRegistered = (request: OnDemandCapabilityLoadRequest): OnDemandCapabilityFailure => ({
  actual: `${request.identifier}@${request.version}`,
  code: 'not_registered',
  field: 'registry',
  message: 'The requested capability bundle is not registered.',
});

/**
 * Loads a registered bundle and re-validates it against the request identity,
 * version, hash, and every atomic component. Any drift is non-executable.
 */
export const loadAtomicCapabilityBundle = (
  registry: AtomicCapabilityRegistry,
  request: OnDemandCapabilityLoadRequest,
): OnDemandCapabilityValidationResult => {
  const candidate = registry.get(request.identifier, request.version);
  if (!candidate) {
    return { errors: Object.freeze([notRegistered(request)]), ok: false };
  }

  return validateAtomicCapabilityBundle(candidate, request);
};
