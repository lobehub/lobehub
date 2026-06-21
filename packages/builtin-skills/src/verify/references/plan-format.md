# Verify plan — machine-readable format

The plan is the contract between the task config and you, the builder. It is
exposed through two `lh` reads keyed off your operation id. This file documents
their shapes and how to join them into a per-criterion worklist.

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

## (b) `lh verify result list --operation $LOBE_OPERATION_ID --json`

Returns one pending **check result** row per plan item — these carry the upload
handle:

```jsonc
[
  {
    "id": "vcr_x9y8z7", // checkResultId — pass this to upload-evidence
    "checkItemId": "vci_a1b2c3", // joins back to verifyPlan[].id
    "checkItemTitle": "Login flow reaches the workspace",
    "required": true,
    "status": "pending",
  },
]
```

If this returns rows with `status: "pending"`, the handles are ready. If it is
empty, the run did not pre-build result handles — surface that rather than
guessing an id.

## The join → your worklist

Join (a) and (b) on `checkItemId` to get, per criterion, _what to prove_ and
_where to attach it_:

| checkItemId  | title                            | requiredEvidence | checkResultId |
| ------------ | -------------------------------- | ---------------- | ------------- |
| `vci_a1b2c3` | Login flow reaches the workspace | `screenshot`     | `vcr_x9y8z7`  |

For each row with non-empty `requiredEvidence`: capture each type, then
`lh verify evidence upload --check "$CHECK_RESULT_ID" --type TYPE …`.

To build the worklist, dump both reads and join them in your runtime:

```bash
OP="$LOBE_OPERATION_ID"
lh verify plan state "$OP" --json > /tmp/plan.json
lh verify result list --operation "$OP" --json > /tmp/results.json
# join on the id fields:
#   plan:   verifyPlan[].id          == checkItemId
#   result: [].checkItemId → [].id   == checkResultId
```
