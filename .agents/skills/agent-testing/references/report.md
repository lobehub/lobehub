# Structured Test Reports

Every automated test session ends with a structured, evidence-backed report.
A chat-only summary is not an acceptable deliverable: the report is what the
user (or a reviewer, or a later agent) audits without replaying the session.

## Location & layout

Reports live under `.records/reports/` (gitignored, like all `.records/`
output):

```
.records/reports/<YYYYMMDD-HHMMSS>-<slug>/
├── report.md      # human-readable report (embedded screenshots, case table, verdict)
├── result.json    # machine-readable results (pass/fail counts, score)
└── assets/        # evidence: screenshots, HAR files, CLI transcripts
```

## Workflow

1. **Scaffold up front** — before running the first test step:

   ```bash
   DIR=$(./.agents/skills/agent-testing/scripts/report-init.sh < slug > "<title>")
   ```

   The script creates the directory, pre-fills branch / commit / date in both
   files, and prints the directory path.

2. **Collect evidence as you test** — every asserted behavior gets one evidence
   item in `$DIR/assets/`:
   - UI (static state): `agent-browser screenshot` or `capture-app-window.sh`,
     then **verify the screenshot with the Read tool before citing it** —
     never cite an image you haven't looked at.
   - UI (time-based behavior): **screenshot vs GIF is a judgment you must
     make per case.** If the assertion is about change over time — streaming
     output, a ticking timer, loading/progress states, animations,
     appear/disappear transitions — a static screenshot cannot prove it.
     Record a frame sequence and synthesize a GIF:

     ```bash
     # start recording (background), trigger the behavior, wait for it to finish
     ../scripts/record-gif.sh "$DIR/assets/case2-streaming.gif" 12 2 &
     GIF_PID=$!
     # ... drive the scenario ...
     wait $GIF_PID
     ```

     Embed it like an image: `![case 2](assets/case2-streaming.gif)`. Verify
     at least the first/last frames visually (Read the GIF) before citing.
   - CLI: exact command + trimmed output (`$CLI task list | tee "$DIR/assets/task-list.txt"`).
   - Network: `agent-browser network requests` dumps or HAR files.

3. **Fill `report.md` as you go** — don't reconstruct from memory at the end.

4. **Set the verdict** in both `report.md` and `result.json`, then link the
   report directory in your final answer to the user.

## Report language (hard rule)

**`report.md` MUST be written in the language the user is conversing in** —
the whole file, headings included. If the conversation is in Chinese, the
report is in Chinese; do not mix English prose into it. The scaffold's English
headings are placeholders — translate them when filling. Exceptions that stay
as-is: code/commands, identifiers, log excerpts, and `result.json` (its keys
and status values are machine-read and stay English; the `title` and case
`name` fields follow the user's language).

## report.md sections

| Section         | Content                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| **Scope**       | What changed / what is being verified; branch + commit                             |
| **Environment** | Server URL, surfaces used (cli / electron / web / bot), relevant versions          |
| **Cases**       | Table: `# \| case \| surface \| steps \| expected \| actual \| status \| evidence` |
| **Evidence**    | Embedded screenshots/GIFs (`![case 1](assets/case1.png)`), fenced CLI transcripts  |
| **Verdict**     | Pass/fail/blocked counts, optional 0–100 score, open issues / follow-ups           |

Status values: `pass` / `fail` / `blocked` (couldn't run — e.g. auth or env
missing; a blocked case is not a pass).

## result.json schema

```json
{
  "branch": "feat/task-tree",
  "cases": [
    {
      "id": "1",
      "name": "task tree returns nested children",
      "surface": "cli",
      "status": "pass",
      "evidence": ["assets/task-tree.txt"]
    }
  ],
  "commit": "abc1234",
  "createdAt": "2026-06-11T15:30:00+08:00",
  "summary": {
    "total": 1,
    "passed": 1,
    "failed": 0,
    "blocked": 0,
    "score": 100,
    "verdict": "pass"
  },
  "surfaces": ["cli"],
  "title": "Verify task tree API"
}
```

`score` is optional — use it when the verdict has a subjective component (UI
polish, copy quality); omit it for purely binary runs. `verdict` is the single
word the user reads first: `pass`, `fail`, or `partial`.

## Rules

- **No evidence, no claim** — every `pass`/`fail` in the case table must link
  at least one asset.
- **Screenshots must be visually verified** with the Read tool before being
  cited.
- **Report failures faithfully** — a failing case with clear evidence is a good
  report; a vague green one is not.
- If coverage was cut (cases skipped, surfaces not exercised), say so in the
  Verdict section — silent truncation reads as "covered everything".
