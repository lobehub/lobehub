import { describe, expect, it } from 'vitest';

import { loadAtomicCapabilityBundle } from '../bundleLoader';
import {
  computeAtomicCapabilityBundleHash,
  validateAtomicCapabilityBundle,
} from '../bundleValidator';
import { hashContent } from '../canonical';
import { AtomicCapabilityRegistry } from '../registry';
import { cloneCapabilityBundle, makeCapabilityBundle } from './fixtures';

describe('AtomicCapabilityRegistry and loader', () => {
  it('loads a registered bundle only when identity, version, and hash match', () => {
    const bundle = makeCapabilityBundle();
    const registry = new AtomicCapabilityRegistry();

    expect(registry.register(bundle).ok).toBe(true);
    const result = loadAtomicCapabilityBundle(registry, {
      hash: bundle.hash,
      identifier: bundle.identifier,
      version: bundle.version,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle).toEqual(bundle);
      expect(result.bundle.manifest).toBe(bundle.manifest);
      expect(result.bundle.manifest.api[0].humanIntervention).toBe('required');
      expect(result.bundle.manifest.api[0].renderDisplayControl).toBe('alwaysExpand');
      expect(result.bundle.manifest).toHaveProperty(
        'ui',
        expect.objectContaining({
          height: 480,
          mode: 'iframe',
          url: 'https://example.com/native-fixture',
        }),
      );
    }
  });

  it('fails closed for an unregistered bundle', () => {
    const result = loadAtomicCapabilityBundle(new AtomicCapabilityRegistry(), {
      hash: 'md5:missing',
      identifier: 'missing-tool',
      version: '1.0.0',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('not_registered');
  });

  it('rejects a conflicting registration for the same identifier and version', () => {
    const first = makeCapabilityBundle();
    const second = cloneCapabilityBundle();
    const mutableSecond = second as typeof second & {
      manual: { content: string; hash: string };
      hash: string;
    };
    mutableSecond.manual.content = 'different manual';
    mutableSecond.manual.hash = hashContent({ content: mutableSecond.manual.content });
    const { hash: _hash, ...secondContent } = mutableSecond;
    mutableSecond.hash = computeAtomicCapabilityBundleHash(secondContent);

    const Registry = new AtomicCapabilityRegistry();
    expect(Registry.register(first).ok).toBe(true);

    const result = Registry.register(second);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('duplicate_conflict');
  });

  it('detects drift after registration and refuses execution', () => {
    const bundle = cloneCapabilityBundle();
    const registry = new AtomicCapabilityRegistry();
    expect(registry.register(bundle).ok).toBe(true);

    const mutable = bundle as typeof bundle & {
      manual: { content: string };
    };
    mutable.manual.content = 'changed after registration';

    const result = loadAtomicCapabilityBundle(registry, {
      hash: bundle.hash,
      identifier: bundle.identifier,
      version: bundle.version,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('manual_hash_mismatch');
    }
  });

  it('does not register an invalid bundle', () => {
    const { permissions: _permissions, ...bundle } = cloneCapabilityBundle();
    const registry = new AtomicCapabilityRegistry();

    expect(registry.register(bundle)).toEqual(validateAtomicCapabilityBundle(bundle));
    expect(registry.get('fixture-native', '1.0.0')).toBeUndefined();
  });
});
