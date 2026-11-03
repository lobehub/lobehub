# Interaction cost (GOMS-KLM)

An optional overlay for **UI rounds**: while you drive the product, record what a
person would have had to do to reach the same state. The round then carries a
_user-equivalent_ interaction cost, so a flow can be judged on what it costs to
walk, not just on whether it passed.

**Where it surfaces:** in that round's report, as its own collapsible section —
which on the acceptance page opens from the round history, available to the
acceptance owner. It is not part of the shared aggregate a non-owner viewer
sees, so never promise a reviewer they will see it there.

**Skip it whenever it does not apply.** A CLI or backend round has no interaction
to price. A machine without a UI driver installed (no `agent-browser`) records no
trace. In both cases you publish exactly as usual — no trace file, no cost
section, no warning. Never hand-write the numbers to fill the gap.

## The seam: you count actions, the platform prices them

You never compute seconds. The driver appends one JSON atom per action to
`interaction-trace.jsonl` in the report directory, carrying raw **operator
counts**; `lh acceptance run ingest` finds that file and prices it with the
platform's pinned timing model (`goms-klm@lobe-v1`).

That split is the point: every round is priced by one model, and any published
number can be recomputed from its trace. A summary you calculated yourself is not
comparable with anyone else's.

```jsonl
{"schema":"lobehub.agentBrowserKlmTrace@1","type":"action","phase":{"id":"login","label":"Sign in"},"klm":{"category":"action","operators":{"P":1,"K":1}},"durationMs":840}
{"schema":"lobehub.agentBrowserKlmTrace@1","type":"mental_estimate","phase":{"id":"first-view"},"klm":{"category":"mental","operators":{"M":2}},"mentalEstimate":{"score":3,"confidence":0.75,"reason":"Reading the state and deciding the next action"}}
```

| Field                | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `schema`             | Must be `lobehub.agentBrowserKlmTrace@1`; a foreign tag is not summed      |
| `phase.id` / `label` | Groups atoms into a step of the journey; `phase.checkItemId` links a check |
| `klm.operators`      | Raw counts — see the operator table below                                  |
| `klm.category`       | `action` \| `mental` \| `blocked` — `blocked` charges nothing              |
| `durationMs`         | Agent wall-clock, reported separately from the user-equivalent price       |

## Operators

| Operator  | Counts                                    | Typical source                       |
| --------- | ----------------------------------------- | ------------------------------------ |
| `P`       | Pointing at a target                      | `click`, drag                        |
| `K`       | One keystroke / button press              | `click` (the press), `press`         |
| `T_chars` | Characters typed                          | `fill`, `type`                       |
| `H`       | Homing between keyboard and pointer       | Switching input device               |
| `M`       | Mental preparation — **estimated by you** | Deciding, locating, reading state    |
| `R_ms`    | Measured system wait, in ms — not modeled | Navigation / load the user waits out |

Two rules keep the number honest:

- **An action that did not happen costs nothing.** A failed, timed-out, or
  blocked command is recorded with `"category":"blocked"` and zero operators.
  Never charge a retry loop as if a person performed it.
- **`M` is an estimate, and it is yours.** Record it explicitly at the moments a
  person would actually have to think — first view of a screen, choosing between
  options, re-orienting after a state change — with a short reason. Do not
  sprinkle it on every action to inflate the total.

## Publishing

Leave `interaction-trace.jsonl` in the report directory and publish normally:

```bash
lh acceptance run ingest "$REPORT_DIR" --source agent-testing --json
```

Ingest computes `interactionCost` and stores it on the round. If a trace exists
but records nothing priceable — every action blocked, for instance — the round
publishes without a cost section rather than claiming a 0s journey. An explicit
`result.json.interactionCost` is left untouched, so a driver that already
computed a summary is never overwritten.
