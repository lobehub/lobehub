import type { AtomicCapabilityBundle } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  computeAtomicCapabilityBundleHash,
  validateAtomicCapabilityBundle,
} from '../bundleValidator';
import { cloneCapabilityBundle, makeCapabilityBundle, nativeManifest } from './fixtures';

const expectCode = (result: ReturnType<typeof validateAtomicCapabilityBundle>, code: string) => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected validation failure');
  expect(result.errors.map((error) => error.code)).toContain(code);
};

describe('validateAtomicCapabilityBundle', () => {
  it('accepts a complete native bundle and preserves intervention and UI metadata', () => {
    const bundle = makeCapabilityBundle();
    const result = validateAtomicCapabilityBundle(bundle, {
      hash: bundle.hash,
      identifier: bundle.identifier,
      version: bundle.version,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a valid bundle');
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
    expect(result.bundle.manifest).toEqual(nativeManifest);
  });

  it('fails closed when the native manifest is missing', () => {
    const { manifest: _manifest, ...bundle } = cloneCapabilityBundle();

    expectCode(validateAtomicCapabilityBundle(bundle), 'manifest_missing');
  });

  it('fails closed when permissions are missing', () => {
    const { permissions: _permissions, ...bundle } = cloneCapabilityBundle();

    expectCode(validateAtomicCapabilityBundle(bundle), 'permissions_missing');
  });

  it('fails closed when the manual or source/runtime pair is missing', () => {
    const { manual: _manual, ...missingManual } = cloneCapabilityBundle();
    expectCode(validateAtomicCapabilityBundle(missingManual), 'manual_missing');

    const { sourceRuntime: _sourceRuntime, ...missingSource } = cloneCapabilityBundle();
    const result = validateAtomicCapabilityBundle(missingSource);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining(['source_missing', 'runtime_missing']),
      );
    }
  });

  it('fails closed when the execution environment or transport is missing', () => {
    const missingEnvironment = cloneCapabilityBundle();
    const mutableExecution = missingEnvironment.execution as {
      environment: string;
    };
    mutableExecution.environment = '';
    expectCode(validateAtomicCapabilityBundle(missingEnvironment), 'execution_environment_missing');

    const missingTransport = cloneCapabilityBundle();
    const mutableTransport = missingTransport.execution as {
      transport: string;
    };
    mutableTransport.transport = '';
    expectCode(validateAtomicCapabilityBundle(missingTransport), 'execution_transport_missing');
  });

  it('fails closed on version and expected-hash drift', () => {
    const bundle = makeCapabilityBundle();

    expectCode(
      validateAtomicCapabilityBundle(bundle, {
        hash: bundle.hash,
        identifier: bundle.identifier,
        version: '2.0.0',
      }),
      'version_mismatch',
    );
    expectCode(
      validateAtomicCapabilityBundle(bundle, {
        hash: 'md5:not-the-bundle',
        identifier: bundle.identifier,
        version: bundle.version,
      }),
      'hash_mismatch',
    );
  });

  it('fails closed when component content and hashes drift', () => {
    const bundle = cloneCapabilityBundle();
    const mutable = bundle as AtomicCapabilityBundle & {
      manual: { content: string };
    };
    mutable.manual.content = 'drifted manual';

    expectCode(validateAtomicCapabilityBundle(bundle), 'manual_hash_mismatch');

    const manifestDrift = cloneCapabilityBundle();
    manifestDrift.manifest.api[0].description = 'drifted schema';
    expectCode(validateAtomicCapabilityBundle(manifestDrift), 'manifest_hash_mismatch');
  });

  it('fails closed when the required hashes are absent', () => {
    const { hash: _hash, manifestHash: _manifestHash, ...bundle } = cloneCapabilityBundle();

    const result = validateAtomicCapabilityBundle(bundle);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation failure');
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['hash_missing', 'manifest_hash_mismatch']),
    );
  });

  it('recomputes the public bundle hash from atomic content', () => {
    const bundle = cloneCapabilityBundle();
    const { hash: _hash, ...content } = bundle;

    expect(computeAtomicCapabilityBundleHash(content)).toBe(bundle.hash);
  });
});
