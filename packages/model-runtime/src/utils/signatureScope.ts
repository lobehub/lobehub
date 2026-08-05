export type SignatureScopeKind = 'reasoning' | 'thought_signature';

export interface SignatureScopeSource {
  apiType: string;
  channelId?: string;
  provider: string;
  routerId?: string;
}

export interface SignatureScope {
  fingerprint: string;
}

const SCOPED_SIGNATURE_PREFIX = 'lobe-scoped-state-v1:';
const SIGNATURE_SCOPE_FINGERPRINT_LENGTH = 32;

/**
 * Keep RouterRuntime provenance off constructor options so internal routing metadata
 * cannot leak into provider SDKs through an options spread.
 */
const runtimeSignatureScopeSources = new WeakMap<object, SignatureScopeSource>();

const createFingerprint = async (identityParts: string[]) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(identityParts)),
  );

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, SIGNATURE_SCOPE_FINGERPRINT_LENGTH);
};

export const setRuntimeSignatureScopeSource = (runtime: object, source: SignatureScopeSource) => {
  runtimeSignatureScopeSources.set(runtime, source);
};

export const getRuntimeSignatureScopeSource = (runtime: object) =>
  runtimeSignatureScopeSources.get(runtime);

/**
 * Derive a stable channel identifier without persisting credentials or endpoint secrets.
 */
export const createSignatureChannelId = async (...identityParts: string[]) =>
  createFingerprint(['channel', ...identityParts]);

/**
 * Build the persisted scope fingerprint from the complete replay boundary.
 * Missing channel identity fails closed because provider and model alone cannot
 * distinguish credentials, endpoints, subscription accounts, or router channels.
 */
export const createSignatureScope = async ({
  kind,
  model,
  protocol,
  source,
}: {
  kind: SignatureScopeKind;
  model: string;
  protocol: string;
  source?: SignatureScopeSource;
}): Promise<SignatureScope | undefined> => {
  if (!source?.channelId) return undefined;

  return {
    fingerprint: await createFingerprint([
      'scope',
      kind,
      source.provider,
      model,
      source.apiType,
      protocol,
      source.routerId ?? '',
      source.channelId,
    ]),
  };
};

/**
 * Store opaque provider state in its existing string field while binding it to a
 * compact, non-secret scope fingerprint.
 */
export const serializeScopedSignature = (
  signature: string | undefined,
  scope: SignatureScope | undefined,
  kind: SignatureScopeKind,
) => {
  if (!signature || !scope) return undefined;

  return `${SCOPED_SIGNATURE_PREFIX}${kind}:${scope.fingerprint}:${signature}`;
};

/**
 * Restore opaque state only for an exact scope match. Legacy unscoped values and
 * malformed envelopes are deliberately rejected instead of being replayed blindly.
 */
export const resolveScopedSignature = (
  value: string | undefined,
  scope: SignatureScope | undefined,
  kind: SignatureScopeKind,
) => {
  if (!value || !scope) return undefined;

  const prefix = `${SCOPED_SIGNATURE_PREFIX}${kind}:`;
  if (!value.startsWith(prefix)) return undefined;

  const fingerprintStart = prefix.length;
  const fingerprintEnd = fingerprintStart + SIGNATURE_SCOPE_FINGERPRINT_LENGTH;
  if (value[fingerprintEnd] !== ':') return undefined;

  const fingerprint = value.slice(fingerprintStart, fingerprintEnd);
  if (fingerprint !== scope.fingerprint) return undefined;

  return value.slice(fingerprintEnd + 1) || undefined;
};
