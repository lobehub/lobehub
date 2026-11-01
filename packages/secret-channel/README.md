# @lobechat/secret-channel

The Agent Secret Channel (ASC/1, `draft-asc-protocol-00`) crypto core: signed single-use
requests, the canonical 14-field AAD, HPKE (RFC 9180) envelope seal/open and redaction
placeholders.

`src/asc/` is vendored unchanged from the reference implementation
(`agent-secret-channel` → `packages/asc-core`): it equals `main` `442ae4d` with the fix branches
`fix/redact-short-secret-variants` (`e078942`), `fix/fail-closed-suite-and-version` (`5f6f40d`),
`fix/frame-and-expiry-hardening` (`d1ab2d2`), `fix/opener-request-version` (`8f2e39d`, stacked on
`fix/frame-and-expiry-hardening`), `fix/malformed-identity-key` (`6681e84`) and
`fix/collision-free-placeholder` (`1761f01`, stacked on `fix/streaming-redaction-overlap`) applied.
`test/vectors/` are the protocol's test vectors, so `test/vectors.test.ts` proves this copy is
byte-for-byte conformant. Update both together; never edit `src/asc/` here without changing the
upstream first.

Two files are LobeHub additions: `src/persistedRecipient.ts`, a per-request recipient key that can be
stored between two HTTP requests (serverless Executor), opened with the same checks and error
codes as `EphemeralRecipient.open`; and `src/derivedIdentity.ts`, a stable Executor identity derived
with HKDF from a secret every server instance shares. `src/index.ts` re-exports all three. Lint and Prettier skip the vendored files
(`eslint.config.mjs`, `.prettierignore`) so they stay byte-identical to upstream.

Licensed Apache-2.0 (same as upstream).
