# Verify plan — machine-readable format

The plan is the contract between the task config and you, the builder. It is
exposed through `lh verify plan state` keyed off your operation id. This file
documents its shape and how to turn it into a per-criterion worklist. You submit
each criterion's evidence by its `checkItemId` — no separate upload handle to
resolve.

## (a) `lh verify plan state $LOBE_OPERATION_ID --json`

Returns the run's verify state plus the **frozen plan** (immutable once
confirmed):

```jsonc
{
  "verifyStatus": "planned",
  "verifyPlanConfirmedAt": "2026-06-21T07:00:00.000Z",
  "verifyPlan": [
    {
      "id": "vci_a1b2c3", // checkItemId — the stable join key
      "index": 0,
      "title": "Login flow reaches the workspace",
      "description": "After sign-in the home renders the workspace switcher",
      "required": true, // true ⇒ blocks delivery if unproven
      "verifierType": "llm",
      "verifierConfig": {
        "requiredEvidence": [
          // the artifacts you MUST capture
          { "type": "screenshot", "hint": "logged-in home with workspace switcher" },
        ],
      },
    },
  ],
}
```

- `verifyPlan[].id` is the **checkItemId** — never use `index` as a key, it is
  display ordering only.
- `verifyPlan[].verifierConfig.requiredEvidence` is the list of `{ type, hint }`
  you must satisfy. Absent or empty ⇒ this criterion is judged on text alone.
- `hint` is guidance for what the artifact should show — it is not validated, but
  follow it so the reviewer can recognize the proof.

## Your worklist → submit by checkItemId

The plan (a) is all you need. For each `verifyPlan[]` item with non-empty
`requiredEvidence`, capture each `type` and submit it by `checkItemId`:

| checkItemId  | title                            | requiredEvidence |
| ------------ | -------------------------------- | ---------------- |
| `vci_a1b2c3` | Login flow reaches the workspace | `screenshot`     |

```bash
OP="$LOBE_OPERATION_ID"
lh verify submit --operation "$OP" --item vci_a1b2c3 --type screenshot \
  --file ./proof/home.png --by agent-browser --desc "…"
```

`lh verify submit` resolves the session from the operation id and **creates the
check-result row for you** (idempotent on `checkItemId`), then attaches the
evidence — there is no `checkResultId` to look up first.

## Self-check after submitting (optional)

Once you've submitted, the result rows exist. To confirm coverage, read them back
and list each row's evidence:

```jsonc
// lh verify result list --operation "$OP" --json
[
  {
    "id": "vcr_x9y8z7", // checkResultId (created by submit)
    "checkItemId": "vci_a1b2c3", // joins back to verifyPlan[].id
    "status": "running",
  },
]
```

```bash
lh verify evidence list "$CHECK_RESULT_ID" --json # confirm each required type is present
```
