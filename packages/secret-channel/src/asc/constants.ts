/** ASC wire/protocol version (spec §4, §9). Bumping it changes every domain-separation label. */
export const ASC_VERSION = 1 as const;

/** HPKE (RFC 9180) Base mode suite (spec §6.1). A Request without a `suite` member uses it. */
export const ASC_SUITE = 'DHKEM-X25519-HKDF-SHA256/HKDF-SHA256/AES-256-GCM' as const;
/** HPKE Auth mode suite: the Client authenticates with its paired static key (spec §6.1, §6.10). */
export const ASC_SUITE_AUTH = 'DHKEM-X25519-HKDF-SHA256/HKDF-SHA256/AES-256-GCM/mode_auth' as const;
export type AscSuite = typeof ASC_SUITE | typeof ASC_SUITE_AUTH;
export const ASC_SUITES: readonly string[] = [ASC_SUITE, ASC_SUITE_AUTH];
export const ASC_SUITE_IDS = { aead: 0x0002, kdf: 0x0001, kem: 0x0020 } as const;

/** Domain-separation labels (spec §6.1, §6.4, §6.5). */
export const ASC_HPKE_INFO = 'asc/v1/hpke-info';
export const ASC_AAD_MAGIC = 'asc/v1/aad';
export const ASC_SIGNATURE_CONTEXT = 'asc/v1/request-sig';

/** Request lifetime (spec §6.7). */
export const ASC_DEFAULT_TTL_SEC = 300;
export const ASC_MAX_TTL_SEC = 900;

/** Plaintext framing (spec §6.6). */
export const ASC_PAD_BLOCK = 256;
export const ASC_MAX_SECRET_BYTES = 4093;

/** Envelope size bounds (spec §6.8). */
export const ASC_MAX_ENC_B64_LENGTH = 64;
export const ASC_MAX_CT_B64_LENGTH = 8192;

/** Values shorter than this are not full-text redacted (spec §7.4). */
export const ASC_MIN_REDACT_LENGTH = 4;
