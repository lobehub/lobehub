# Structured Test Reports

Every automated test session ends with a structured, evidence-backed report.
A chat-only summary is not an acceptable deliverable: the report is what the
user (or a reviewer, or a later agent) audits without replaying the session.

## Location & layout

Reports live under `.records/reports/` (gitignored, like all `.records/`
output):

```
.records/reports/<YYYYMMDD-HHMMSS>-<slug>/
├── report.md      # human-readable report (case table with inline screenshots, verdict)
├── result.json    # machine-readable results (pass/fail counts, score)
└── assets/        # evidence: screenshots, HAR files, CLI transcripts
```

## Workflow

1. **Scaffold up front** — before running the first test step:

   ```bash
   DIR=$(./.agents/skills/agent-testing/scripts/report-init.sh < slug > "<title>")
   ```

   The script creates the directory, pre-fills branch / commit / date in both
   files, and prints the directory path. The scaffold uses the compact report
   shape below; translate its headings and table labels to the user's language
   before delivery if needed.

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
   The primary evidence belongs in the case table itself: each row should pair
   the assertion with the screenshot/GIF or non-visual artifact that proves it,
   so readers can scan the result without jumping between sections. UI evidence
   must render inline with Markdown image syntax; a plain link or file path is
   not acceptable as primary visual evidence.

4. **Set the verdict** in both `report.md` and `result.json`, then link the
   report directory in your final answer to the user. If UI evidence exists,
   list the key screenshot/GIF links in the final chat response. Use Markdown
   link text as the evidence caption, for example:
   `[Image #1 - observed outcome](<report-dir>/assets/case1.png)`.

## Report language (hard rule)

**`report.md` MUST be written in the language the user is conversing in** —
the whole file, headings included. If the conversation is in Chinese, the
report is in Chinese; do not mix English prose into it. The scaffold headings
are placeholders — translate them when filling if the user is not conversing in
the scaffold language. Exceptions that stay as-is: code/commands, identifiers,
log excerpts, and `result.json` (its keys and status values are machine-read
and stay English; the `title` and case `name` fields follow the user's
language).

## report.md sections

Default report shape:

| Section          | Content                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **Scope**        | What changed / what is being verified; branch, commit, date, surface, entry URL/page, focus  |
| **Cases**        | Compact table: `# \| Case \| Result \| Key observation \| Evidence`                          |
| **Verdict**      | Overall verdict first (`pass` / `partial` / `fail`), then the concise reasons and follow-ups |
| **Verification** | Commands or automated checks run in this session, with trimmed results                       |
| **Score**        | Pass/fail/blocked counts, optional 0–100 score                                               |

The case table is the main reading surface. Prefer one clear row per user
scenario or regression assertion, and put the screenshot/GIF directly in the
`Evidence` cell:

```markdown
| #   | Case                     | Result | Key observation                                                   | Evidence                                         |
| --- | ------------------------ | ------ | ----------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Create a new page        | pass   | Title and body persisted after refresh                            | ![created page](assets/new-page-created.png)     |
| 2   | Respect requested length | fail   | Requested about 600 Chinese characters; final body was about 1286 | ![final article](assets/write-article-final.png) |
```

## Inline visual evidence

Screenshots and GIFs must be embedded so the report shows the image inline:

```markdown
![case 1 result](assets/case1-result.png)
![streaming response](assets/case2-streaming.gif)
```

Do **not** use these as the primary evidence for UI cases:

```markdown
[case 1 result](assets/case1-result.png)
assets/case1-result.png
file:///tmp/case1-result.png
```

Links are acceptable for non-visual artifacts such as CLI transcripts, HAR
files, or long logs. For videos, embed a representative screenshot/GIF inline in
the case row and link the full video as supplemental evidence.

Avoid the old wide table with separate `steps`, `expected`, and `actual`
columns unless the test is purely non-visual and truly needs that breakdown.
For UI reports, those columns make screenshot-backed reading harder. Put
procedural detail in the row's key observation only when it changes the
interpretation of the result.

Use an extra evidence/detail section only when the inline table cannot carry
the material cleanly, such as long CLI transcripts, HAR summaries, or multiple
screenshots for one case. In that situation, keep the table evidence cell as an
inline visual proof for UI cases or a concise link for non-visual artifacts,
then put the longer material under `Verification` or a brief
`Additional Evidence` section.

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
  at least one asset. UI cases must inline-embed their primary screenshot/GIF;
  non-visual CLI/network cases may link transcripts, HAR files, or logs.
- **Screenshots must be visually verified** with the Read tool before being
  cited.
- **Report failures faithfully** — a failing case with clear evidence is a good
  report; a vague green one is not.
- If coverage was cut (cases skipped, surfaces not exercised), say so in the
  Verdict section — silent truncation reads as "covered everything".
