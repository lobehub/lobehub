import type {
  AtomicCapabilityBundle,
  OnDemandCapabilityExpectation,
  OnDemandCapabilityFailure,
  OnDemandCapabilityValidationResult,
} from '@lobechat/types';
import { BuiltinToolManifestSchema, ToolManifestSchema } from '@lobechat/types';

import { hashContent } from './canonical';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const EXECUTION_ENVIRONMENTS = new Set(['client', 'device', 'sandbox', 'server']);
const EXECUTION_TRANSPORTS = new Set([
  'builtin-native',
  'device-gateway',
  'http',
  'in-process',
  'mcp',
]);
const CAPABILITY_RUNTIMES = new Set([
  'agent-runtime',
  'client',
  'mcp-runtime',
  'plugin-runtime',
  'server',
]);
const CAPABILITY_SOURCES = new Set([
  'builtin',
  'composio',
  'lobehub-skill',
  'mcp',
  'plugin',
  'skill',
]);

const manifestHash = (bundle: AtomicCapabilityBundle): string => hashContent(bundle.manifest);
const manualHash = (bundle: AtomicCapabilityBundle): string =>
  hashContent({ content: bundle.manual?.content });
const permissionsHash = (bundle: AtomicCapabilityBundle): string =>
  hashContent({
    grants: bundle.permissions?.grants,
    sharedAuthorizations: bundle.permissions?.sharedAuthorizations,
  });
const executionHash = (bundle: AtomicCapabilityBundle): string =>
  hashContent({
    environment: bundle.execution?.environment,
    transport: bundle.execution?.transport,
  });

const parseNativeManifest = (manifest: unknown) => {
  const hasToolManifestFields =
    manifest !== null && typeof manifest === 'object' && 'ui' in manifest;
  const firstAttempt = hasToolManifestFields
    ? ToolManifestSchema.safeParse(manifest)
    : BuiltinToolManifestSchema.safeParse(manifest);

  if (firstAttempt.success || hasToolManifestFields) return firstAttempt;

  return ToolManifestSchema.safeParse(manifest);
};

export const computeAtomicCapabilityBundleHash = (
  bundle: Omit<AtomicCapabilityBundle, 'hash'> & { hash?: string },
): string => {
  const { hash: _hash, ...content } = bundle;
  return hashContent(content);
};

const failure = (
  code: OnDemandCapabilityFailure['code'],
  field: string,
  message: string,
  values: Pick<OnDemandCapabilityFailure, 'actual' | 'expected'> = {},
): OnDemandCapabilityFailure => ({ code, field, message, ...values });

/**
 * Fail-closed validation for an atomic native capability bundle. All fields
 * must be present and every content hash must match before a loader may expose
 * the bundle as executable.
 */
export const validateAtomicCapabilityBundle = (
  candidate: unknown,
  expectation?: OnDemandCapabilityExpectation,
): OnDemandCapabilityValidationResult => {
  const errors: OnDemandCapabilityFailure[] = [];

  if (!candidate || typeof candidate !== 'object') {
    return {
      errors: Object.freeze([failure('bundle_missing', 'bundle', 'Capability bundle is missing.')]),
      ok: false,
    };
  }

  const bundle = candidate as Partial<AtomicCapabilityBundle>;

  if (!isNonEmptyString(bundle.identifier)) {
    errors.push(failure('identifier_missing', 'identifier', 'Capability identifier is missing.'));
  }

  if (!bundle.manifest || typeof bundle.manifest !== 'object') {
    errors.push(failure('manifest_missing', 'manifest', 'Native tool manifest is missing.'));
  } else {
    const parsedManifest = parseNativeManifest(bundle.manifest);
    if (!parsedManifest.success) {
      errors.push(
        failure(
          'manifest_invalid',
          'manifest',
          `Native tool manifest is invalid: ${parsedManifest.error.message}`,
        ),
      );
    } else if (
      isNonEmptyString(bundle.identifier) &&
      parsedManifest.data.identifier !== bundle.identifier
    ) {
      errors.push(
        failure(
          'identifier_mismatch',
          'manifest.identifier',
          'Bundle identifier does not match the native manifest identifier.',
          { actual: parsedManifest.data.identifier, expected: bundle.identifier },
        ),
      );
    }

    if (parsedManifest.success && parsedManifest.data.api.length === 0) {
      errors.push(
        failure('manifest_invalid', 'manifest.api', 'Native tool manifest exposes no APIs.'),
      );
    }
  }

  if (!bundle.manual || !isNonEmptyString(bundle.manual.content)) {
    errors.push(failure('manual_missing', 'manual', 'Capability manual is missing.'));
  }

  if (
    !bundle.permissions ||
    !Array.isArray(bundle.permissions.grants) ||
    bundle.permissions.grants.length === 0 ||
    !Array.isArray(bundle.permissions.sharedAuthorizations)
  ) {
    errors.push(
      failure(
        'permissions_missing',
        'permissions',
        'Permissions and shared authorization state are required.',
      ),
    );
  } else {
    const invalidGrant = bundle.permissions.grants.some(
      (grant) =>
        !grant ||
        !isNonEmptyString(grant.principal?.id) ||
        !isNonEmptyString(grant.principal?.type) ||
        !Array.isArray(grant.scopes) ||
        grant.scopes.length === 0 ||
        grant.scopes.some((scope: unknown) => !isNonEmptyString(scope)),
    );
    if (invalidGrant) {
      errors.push(
        failure(
          'permissions_missing',
          'permissions.grants',
          'Every permission grant needs a principal and at least one non-empty scope.',
        ),
      );
    }
  }

  if (!bundle.execution || typeof bundle.execution !== 'object') {
    errors.push(
      failure('execution_missing', 'execution', 'Capability execution details are missing.'),
    );
  } else {
    if (
      !isNonEmptyString(bundle.execution.environment) ||
      !EXECUTION_ENVIRONMENTS.has(bundle.execution.environment)
    ) {
      errors.push(
        failure(
          'execution_environment_missing',
          'execution.environment',
          'Execution environment is missing.',
        ),
      );
    }

    if (
      !isNonEmptyString(bundle.execution.transport) ||
      !EXECUTION_TRANSPORTS.has(bundle.execution.transport)
    ) {
      errors.push(
        failure(
          'execution_transport_missing',
          'execution.transport',
          'Execution transport is missing.',
        ),
      );
    }
  }

  if (
    !bundle.sourceRuntime ||
    !isNonEmptyString(bundle.sourceRuntime.source) ||
    !CAPABILITY_SOURCES.has(bundle.sourceRuntime.source)
  ) {
    errors.push(failure('source_missing', 'sourceRuntime.source', 'Capability source is missing.'));
  }

  if (
    !bundle.sourceRuntime ||
    !isNonEmptyString(bundle.sourceRuntime.runtime) ||
    !CAPABILITY_RUNTIMES.has(bundle.sourceRuntime.runtime)
  ) {
    errors.push(
      failure('runtime_missing', 'sourceRuntime.runtime', 'Capability runtime is missing.'),
    );
  }

  if (!isNonEmptyString(bundle.version)) {
    errors.push(failure('version_missing', 'version', 'Capability version is missing.'));
  } else if (expectation && bundle.version !== expectation.version) {
    errors.push(
      failure('version_mismatch', 'version', 'Capability version drifted.', {
        actual: bundle.version,
        expected: expectation.version,
      }),
    );
  }

  if (!isNonEmptyString(bundle.hash)) {
    errors.push(failure('hash_missing', 'hash', 'Capability hash is missing.'));
  }

  if (
    expectation &&
    isNonEmptyString(bundle.identifier) &&
    bundle.identifier !== expectation.identifier
  ) {
    errors.push(
      failure(
        'identifier_mismatch',
        'identifier',
        'Capability identifier drifted from the request.',
        { actual: bundle.identifier, expected: expectation.identifier },
      ),
    );
  }

  if (!isNonEmptyString(bundle.manifestHash)) {
    errors.push(
      failure('manifest_hash_mismatch', 'manifestHash', 'Native manifest hash is missing.'),
    );
  } else if (bundle.manifest) {
    const calculated = manifestHash(bundle as AtomicCapabilityBundle);
    if (bundle.manifestHash !== calculated) {
      errors.push(
        failure('manifest_hash_mismatch', 'manifestHash', 'Native manifest hash drifted.', {
          actual: calculated,
          expected: bundle.manifestHash,
        }),
      );
    }
  }

  if (!bundle.manual || !isNonEmptyString(bundle.manual.hash)) {
    errors.push(failure('manual_hash_mismatch', 'manual.hash', 'Manual hash is missing.'));
  } else {
    const calculated = manualHash(bundle as AtomicCapabilityBundle);
    if (bundle.manual.hash !== calculated) {
      errors.push(
        failure('manual_hash_mismatch', 'manual.hash', 'Capability manual hash drifted.', {
          actual: calculated,
          expected: bundle.manual.hash,
        }),
      );
    }
  }

  if (!bundle.permissions || !isNonEmptyString(bundle.permissions.hash)) {
    errors.push(
      failure('permissions_hash_mismatch', 'permissions.hash', 'Permissions hash is missing.'),
    );
  } else {
    const calculated = permissionsHash(bundle as AtomicCapabilityBundle);
    if (bundle.permissions.hash !== calculated) {
      errors.push(
        failure('permissions_hash_mismatch', 'permissions.hash', 'Permissions hash drifted.', {
          actual: calculated,
          expected: bundle.permissions.hash,
        }),
      );
    }
  }

  if (!bundle.execution || !isNonEmptyString(bundle.execution.hash)) {
    errors.push(failure('execution_hash_mismatch', 'execution.hash', 'Execution hash is missing.'));
  } else {
    const calculated = executionHash(bundle as AtomicCapabilityBundle);
    if (bundle.execution.hash !== calculated) {
      errors.push(
        failure('execution_hash_mismatch', 'execution.hash', 'Execution hash drifted.', {
          actual: calculated,
          expected: bundle.execution.hash,
        }),
      );
    }
  }

  if (isNonEmptyString(bundle.hash)) {
    const calculated = computeAtomicCapabilityBundleHash(bundle as AtomicCapabilityBundle);
    if (bundle.hash !== calculated) {
      errors.push(
        failure('hash_mismatch', 'hash', 'Capability bundle hash drifted.', {
          actual: calculated,
          expected: bundle.hash,
        }),
      );
    }

    if (expectation && bundle.hash !== expectation.hash) {
      errors.push(
        failure('hash_mismatch', 'hash', 'Capability hash differs from the request.', {
          actual: bundle.hash,
          expected: expectation.hash,
        }),
      );
    }
  }

  return errors.length > 0
    ? { errors: Object.freeze(errors), ok: false }
    : {
        bundle: bundle as AtomicCapabilityBundle,
        hash: computeAtomicCapabilityBundleHash(bundle as AtomicCapabilityBundle),
        ok: true,
      };
};
