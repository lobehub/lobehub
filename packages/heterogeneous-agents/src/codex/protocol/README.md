# Codex app-server protocol

`generated.ts` vendors the stable TypeScript protocol emitted by Codex at revision
`5e32f728f1f86a967c6be057351f12505778df8f`.

Generate the upstream files with:

```bash
codex app-server generate-ts --out <directory>
```

The vendored file is the transitive stable subset used by LobeHub's native app-server client. Keep
wire names and nullability identical to the generated files; do not hand-edit protocol types.

`approval.ts` carries the additive command/file approval request and response contract from the
newer revision exported as `CODEX_APP_SERVER_APPROVAL_PROTOCOL_REVISION`. It is kept separate so an
approval bridge update does not falsely claim that the full stable subset was regenerated against a
newer, wider protocol.
