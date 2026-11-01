import { verify as cryptoVerify } from 'node:crypto';

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

export const verifyManifestSignature = (
  manifest: { signature: string },
  publicKeyPem: string,
): boolean => {
  const { signature, ...unsigned } = manifest;
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalJson(unsigned)),
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
};
