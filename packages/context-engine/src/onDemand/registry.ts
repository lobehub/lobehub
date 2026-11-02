import type {
  AtomicCapabilityBundle,
  OnDemandCapabilityFailure,
  OnDemandCapabilityValidationResult,
} from '@lobechat/types';

import { validateAtomicCapabilityBundle } from './bundleValidator';
import { hashContent } from './canonical';

const registryKey = (identifier: string, version: string): string =>
  `${identifier}\u0000${version}`;

const failure = (
  code: OnDemandCapabilityFailure['code'],
  field: string,
  message: string,
  values: Pick<OnDemandCapabilityFailure, 'actual' | 'expected'> = {},
): OnDemandCapabilityFailure => ({ code, field, message, ...values });

/**
 * In-memory registry keyed by `identifier@version`. It only registers validated
 * bundles and rejects conflicting content for the same identity/version.
 */
export class AtomicCapabilityRegistry {
  private readonly bundles = new Map<string, AtomicCapabilityBundle>();

  register(candidate: unknown): OnDemandCapabilityValidationResult {
    const validation = validateAtomicCapabilityBundle(candidate);
    if (!validation.ok) return validation;

    const key = registryKey(validation.bundle.identifier, validation.bundle.version);
    const existing = this.bundles.get(key);
    if (existing) {
      const existingHash = hashContent(existing);
      const nextHash = hashContent(validation.bundle);
      if (existingHash !== nextHash) {
        return {
          errors: Object.freeze([
            failure(
              'duplicate_conflict',
              'registry',
              'A different bundle is already registered for this identifier and version.',
              { actual: nextHash, expected: existingHash },
            ),
          ]),
          ok: false,
        };
      }

      return validation;
    }

    // Store the caller's object directly. A later mutation becomes observable
    // hash drift and the loader will fail closed instead of executing stale data.
    this.bundles.set(key, validation.bundle);
    return validation;
  }

  get(identifier: string, version: string): AtomicCapabilityBundle | undefined {
    return this.bundles.get(registryKey(identifier, version));
  }
}
