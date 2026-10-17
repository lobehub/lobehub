import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EphemeralRecipient,
  createSecretRedactor,
  encodeFields,
  encodeRequestAad,
  formatSecretPlaceholder,
  fromHex,
  hashArgv,
  hashDisplay,
  clientKeyFromIkm,
  isAscError,
  isVerifierChecked,
  pairedClientsFrom,
  sanitizeSecretLabel,
  sealSecret,
  secretVariants,
  toHex,
  unframePlaintext,
  utf8Decode,
  verifyRequest,
} from '../src';

const load = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'vectors', name), 'utf8'));

const codeOf = async (fn: () => unknown) => {
  try {
    await fn();
    return null;
  } catch (error) {
    if (isAscError(error)) return error.code;
    throw error;
  }
};

describe('encoding.json', () => {
  const v = load('encoding.json');
  it('encodes fields', () => {
    for (const c of v.encodeFields) expect(toHex(encodeFields(c.fields))).toBe(c.hex);
  });
  it('hashes argv', () => {
    for (const c of v.argvHash) expect(hashArgv(c.argv)).toBe(c.argvHash);
  });
});

describe('aad.json / identity.json', () => {
  const a = load('aad.json');
  const id = load('identity.json');
  it('reproduces displayHash and the canonical AAD', () => {
    expect(hashDisplay(a.request)).toBe(a.displayHash);
    expect(toHex(encodeRequestAad(a.request))).toBe(a.aadHex);
  });
  it('verifies the signature under the pinned fingerprint', () => {
    expect(() => verifyRequest(a.request, { pinnedFingerprint: id.identityKeyFp })).not.toThrow();
    expect(a.request.executor.sig).toBe(id.sig);
  });
});

describe('hpke.json', () => {
  const v = load('hpke.json');
  for (const c of v.cases) {
    it(`seals deterministically and opens: ${c.name}`, async () => {
      const recipient = await EphemeralRecipient.create(fromHex(c.ikmR.hex));
      expect(recipient.publicKey).toBe(c.ephPub);
      const envelope = await sealSecret({
        deterministicIkmE: fromHex(c.ikmE.hex),
        now: c.request.createdAt,
        request: c.request,
        secret: fromHex(c.secretHex),
      });
      expect(envelope).toEqual(c.envelope);
      expect(utf8Decode(await recipient.open(c.request, c.envelope, c.openAt))).toBe(c.secretUtf8);
    });
  }
});

describe('negative.json', () => {
  const v = load('negative.json');
  const fresh = () => EphemeralRecipient.create(fromHex(v.ikmR.hex));

  it('rejects every AAD tampering on both sides', async () => {
    for (const c of v.aadTampering) {
      expect(await codeOf(() => verifyRequest(c.tamperedRequest)), c.name).toBe(c.expectedVerifyError);
      const r = await fresh();
      expect(await codeOf(() => r.open(c.tamperedRequest, v.baseEnvelope, v.openAt)), c.name).toBe(c.expectedOpenError);
      expect(c.expectedOpenError).not.toBeNull();
    }
  });

  it('rejects envelope tampering', async () => {
    for (const c of v.envelopeTampering) {
      const r = await fresh();
      expect(await codeOf(() => r.open(v.baseRequest, c.envelope, c.openAt)), c.name).toBe(c.expectedOpenError);
    }
  });

  it('enforces single use (fail closed)', async () => {
    const r = await fresh();
    expect(await codeOf(() => r.open(v.baseRequest, v.envelopeTampering[0].envelope, v.openAt))).toBe('DECRYPT_FAILED');
    expect(await codeOf(() => r.open(v.baseRequest, v.baseEnvelope, v.openAt))).toBe('REPLAYED');
  });

  it('checks identity and pinning', async () => {
    for (const c of v.identity)
      expect(await codeOf(() => verifyRequest(c.request, { pinnedFingerprint: c.pinnedFingerprint })), c.name).toBe(c.expectedVerifyError);
  });
});

describe('framing.json', () => {
  const v = load('framing.json');
  it('rejects invalid frames', async () => {
    for (const c of v.invalid) expect(await codeOf(() => unframePlaintext(fromHex(c.framedHex))), c.name).toBe(c.expectedError);
  });
});

describe('sender-auth.json', () => {
  const v = load('sender-auth.json');
  const paired = pairedClientsFrom([v.clientKey.publicKey]);

  it('derives the Client key and classifies Requests', async () => {
    const key = await clientKeyFromIkm(fromHex(v.clientKey.ikmS.hex));
    expect(key.publicKey).toBe(v.clientKey.publicKey);
    expect(toHex(key.privateKey)).toBe(v.clientKey.skSHex);
    for (const c of v.classification)
      expect(isVerifierChecked(c.kind, c.targetKind, { setsNewSecret: c.setsNewSecret }) ? 'verifier-checked' : 'value-accepting', `${c.kind}/${c.targetKind}`).toBe(c.class);
  });

  it('seals in Auth mode deterministically and opens only with the paired Client key', async () => {
    const sender = await clientKeyFromIkm(fromHex(v.clientKey.ikmS.hex));
    for (const c of v.positive) {
      const envelope = await sealSecret({ deterministicIkmE: fromHex(c.ikmE.hex), now: c.request.createdAt, request: c.request, secret: new TextEncoder().encode(c.secretUtf8), sender });
      expect(envelope, c.name).toEqual(c.envelope);
      const r = await EphemeralRecipient.create(fromHex(c.ikmR.hex));
      expect(utf8Decode(await r.open(c.request, c.envelope, c.openAt, paired)), c.name).toBe(c.secretUtf8);
    }
  });

  it('rejects every Relay-sealed value for a value-accepting Request', async () => {
    const p0 = v.positive[0];
    for (const c of v.relayInjection) {
      const r = await EphemeralRecipient.create(fromHex(p0.ikmR.hex));
      expect(await codeOf(() => r.open(p0.request, c.envelope, p0.openAt, pairedClientsFrom(c.pairedClients))), c.name).toBe(c.expectedOpenError);
      expect(c.expectedOpenError).not.toBeNull();
      expect(r.state !== 'pending', c.name).toBe(c.consumesKey);
    }
  });

  it('keeps the documented Base-suite residual for verifier-checked Requests', async () => {
    const c = v.baseSuiteResidual;
    const r = await EphemeralRecipient.create(fromHex(c.ikmR.hex));
    expect(utf8Decode(await r.open(c.request, c.envelope, c.openAt))).toBe(v.relayValueUtf8);
  });
});

describe('redaction.json', () => {
  const v = load('redaction.json');

  it('sanitizes labels into placeholders', () => {
    for (const c of v.placeholders) {
      expect(sanitizeSecretLabel(c.label)).toBe(c.sanitized);
      expect(formatSecretPlaceholder(c.label)).toBe(c.placeholder);
    }
  });

  it('registers exactly the representations secretVariants() reports', () => {
    for (const c of v.variants) {
      const redactor = createSecretRedactor();
      redactor.add('test', c.value);
      expect(redactor.size, JSON.stringify(c.value)).toBe(secretVariants(c.value).length);
    }
  });

  it('registers every encoded variant of a secret for redaction', () => {
    for (const c of v.variants) {
      const redactor = createSecretRedactor();
      redactor.add('test', c.value);
      for (const variant of c.variants) {
        expect(redactor.redact(`out ${variant} end`), `${JSON.stringify(c.value)} → ${variant}`).toBe(
          'out «secret:test» end',
        );
      }
    }
  });

  it('still registers the encodings of a secret shorter than the minimum length', () => {
    const redactor = createSecretRedactor();
    redactor.add('short', 'abc');

    expect(redactor.redact('YWJj and 616263')).toBe('«secret:short» and «secret:short»');
  });
});
