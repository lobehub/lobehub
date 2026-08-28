# Codex app-server protocol

`generated.ts` vendors the stable TypeScript protocol emitted by Codex at revision
`5e32f728f1f86a967c6be057351f12505778df8f`.

Generate the upstream files with:

```bash
codex app-server generate-ts --out <directory>
```

The vendored file is the transitive stable subset used by LobeHub's native app-server client. Keep
wire names and nullability identical to the generated files; do not hand-edit protocol types.
