# CLI /backend 端验收

The default surface for backend, CLI, library, and data-logic changes. The proof
is the command's own output — text, not pixels. This is the cheapest and strongest
evidence: a passing assertion or a correct JSON result is harder to fake than a
screenshot, and it runs anywhere (no browser, no display).

Use this surface when your change is verifiable by running something and reading
what it prints. Escalate to [web.md](./web.md) or [electron.md](./electron.md)
only when the criterion is actually about rendered UI.

## How to verify

1. Run the command, test, or query that exercises the change. Prefer a machine
   output mode (`--json`, a structured dump) so the proof is assertable, not prose.
2. Capture the output and upload it as `text` evidence — inline with `--content`
   for short output, or `--file` for a larger dump.

```bash
# CHECK_ITEM_ID is the criterion's plan item id (from `lh verify plan state`).
# short result → inline
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" --type text \
  --content "$(your-cli command --json)" \
  --by cli --desc "command reports the new field after the change"

# larger output (test log, full dump) → file
your-cli command --json > ./proof/result.json
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" --type text \
  --file ./proof/result.json --by cli --desc "full result set"

# a test run is itself proof
your-test-runner path/to/spec > ./proof/test.log 2>&1
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" --type text \
  --file ./proof/test.log --by program --desc "regression spec passes"
```

Provenance: `cli` for command stdout, `program` for a script/test you ran. See
[../references/evidence.md](../references/evidence.md) for the evidence contract.

## Auth

The `lh` CLI you upload with is already authed. A _different_ product CLI under
test carries its own auth (API key or stored login) — configure it before
capturing its output. See [../references/auth.md](../references/auth.md#cli--backend-surface).

## Boundaries

- **Don't open a browser for a backend change.** If the criterion is satisfied by
  output, a screenshot adds noise, not proof.
- **Make the assertion legible.** Upload the specific lines/fields that prove the
  criterion (or describe them in `--desc`), not a 10k-line log the reviewer must
  scan.
- **Never upload secrets.** Strip tokens/keys from output before uploading — see
  [../references/auth.md](../references/auth.md#boundaries--read-before-touching-cookies).
