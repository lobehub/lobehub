# @lobechat/secret-channel

The Agent Secret Channel (ASC/1, `draft-asc-protocol-00`) crypto core: signed single-use
requests, the canonical 14-field AAD, HPKE (RFC 9180) envelope seal/open and redaction
placeholders.

`src/asc/` is vendored unchanged from the reference implementation
(`agent-secret-channel` → `packages/asc-core`, main `442ae4d` plus the redaction fixes `e078942`
and `fbe8c51`, and the fail-closed fixes `5f6f40d`); `test/vectors/` are the
protocol's test vectors, so `test/vectors.test.ts` proves this copy is byte-for-byte
conformant. Update both together; never edit `src/asc/` here without changing the upstream first.

Two files are LobeHub additions: `src/persistedRecipient.ts`, a per-request recipient key that can be
stored between two HTTP requests (serverless Executor), opened with the same checks and error
codes as `EphemeralRecipient.open`; and `src/derivedIdentity.ts`, a stable Executor identity derived
with HKDF from a secret every server instance shares. `src/index.ts` re-exports all three. Lint and Prettier skip the vendored files
(`eslint.config.mjs`, `.prettierignore`) so they stay byte-identical to upstream.

Licensed Apache-2.0 (same as upstream).
