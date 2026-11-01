# CLI / backend surface

The default surface for backend, CLI, library, and data-logic changes. The proof
is the command's own output — text, not pixels. This is the cheapest and strongest
evidence: a passing assertion or a correct JSON result is harder to fake than a
screenshot, and it runs anywhere (no browser, no display).

Use this surface when your change is verifiable by running something and reading
what it prints. Return to the surface router only when the criterion is actually
about rendered UI.

## How to verify

1. Run the command, test, or query that exercises the change. Prefer a machine
   output mode (`--json`, a structured dump) so the proof is assertable, not prose.
2. Save the output into the round's `assets/` and list it in the case's
   `evidence` — ingest inlines small text files and uploads larger dumps.

```bash
your-cli command --json > "$REPORT_DIR/assets/new-field.json"
your-test-runner path/to/spec > "$REPORT_DIR/assets/regression.log" 2>&1
```

```jsonc
// the case in result.json (its id is the plan item id when a plan was handed to you)
"evidence": [
  { "path": "assets/new-field.json", "description": "command reports the new field after the change" },
  { "path": "assets/regression.log", "description": "regression spec passes" }
]
```

When supplementing with `result submit`, `--by` is `cli` for command stdout and
`program` for a script/test you ran. See
[../references/evidence.md](../references/evidence.md) for the evidence contract.

## Auth

The `lh` CLI you upload with is already authed. A _different_ product CLI under
test carries its own auth (API key or stored login) — configure it before
capturing its output, and verify the credential belongs to the intended test
environment.

## Boundaries

- **Don't open a browser for a backend change.** If the criterion is satisfied by
  output, a screenshot adds noise, not proof.
- **Make the assertion legible.** Upload the specific lines/fields that prove the
  criterion (or describe them in `--desc`), not a 10k-line log the reviewer must
  scan.
- **Never upload secrets.** Strip tokens/keys from output before uploading — see
  [../references/evidence.md](../references/evidence.md#artifact-safety).
