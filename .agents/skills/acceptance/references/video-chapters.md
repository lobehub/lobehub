# Video chapters

A recording without chapters asks the reviewer to watch all of it to find the
two seconds that matter. Chapters put your steps and your claims on the video's
timeline: the reviewer jumps to each claim, checks the frame, and rejects the
exact moment you got wrong.

Attach chapters to every `video` evidence you capture yourself. They cost one
command per step while you drive the scenario.

## The three kinds

| Kind    | Means                                                              | Required text        |
| ------- | ------------------------------------------------------------------ | -------------------- |
| `step`  | An action you performed: "Scroll #3", "Submit the form"            | `label` (short name) |
| `check` | Something you verified **on this frame**                           | `note` (the claim)   |
| `flag`  | An anomaly you noticed and judged harmless, disclosed for review   | `note` (what & why)  |

`t` is seconds from the start of the video.

Rules that make chapters trustworthy:

- **A `check` is true of its own frame, not of the whole clip.** "No skeleton on
  this frame after scroll #3" — not "no skeleton anywhere". The reviewer seeks to
  `t` and judges the claim against that picture.
- **Write a `flag` for every anomaly you saw, even one you consider harmless** —
  a request count that ticked up, a one-frame flash, a layout jump. An anomaly
  the reviewer finds that you did not disclose reads as concealment and costs
  more trust than the anomaly itself.
- **A `check` is a claim to audit, never a pass.** It does not replace the
  case `observation`, the frames you inspected, or the reviewer's judgement.
- **Timestamps come from logs, not memory.** Log each mark while driving (below)
  and derive `t` from the recording's own start. Before publishing, extract the
  frame at each `check` and `flag` and confirm it shows what the note says.

## Log marks while you drive

Record wall-clock marks next to the recording, then convert them against the
recording's start time:

```bash
MARKS=./proof/flow.marks.jsonl
mark() { # mark <step|check|flag> <text>
  python3 -c 'import json,sys,time; print(json.dumps({"wall": time.time(), "kind": sys.argv[1], "text": sys.argv[2]}, ensure_ascii=False))' "$1" "$2" >> "$MARKS"
}

mark step "Open the conversation and scroll to the top"
# ... drive the product ...
mark check "Scroll #3: no skeleton, request count still 0"
mark flag "Request count 0 → 1 at the third scroll — a background prefetch; the list did not move"
```

The recording's start time depends on the recorder:

- **CDP frames** ([recording-cdp.md](./recording-cdp.md)): the first line of
  `frames.log`.
- **`simctl` / `ffmpeg` recorders**: log `mark step "Recording started"` the
  moment the recorder reports it started, and use that mark's `wall` as the
  start.

Convert marks into chapters:

```bash
START=$(head -1 "$FRAME_DIR/frames.log" | cut -d' ' -f2) # or the "Recording started" mark
python3 - "$MARKS" "$START" > ./proof/flow.chapters.json <<'PY'
import json, sys
marks, start = sys.argv[1], float(sys.argv[2])
chapters = []
for line in open(marks):
    m = json.loads(line)
    key = "label" if m["kind"] == "step" else "note"
    chapters.append({"kind": m["kind"], "t": round(max(m["wall"] - start, 0), 2), key: m["text"]})
print(json.dumps(chapters, ensure_ascii=False, indent=1))
PY
```

## Attach them

Authored rounds put `chapters` on the video's evidence entry in `result.json`:

```json
"evidence": [
  { "path": "assets/scroll-top.mp4",
    "description": "Five scrolls at the top of a short topic; the overlay shows the current action and the request count.",
    "chapters": [
      { "kind": "step", "t": 6, "label": "Scroll #3" },
      { "kind": "flag", "t": 7, "note": "Request count 0 → 1 — a background prefetch; the list did not move" },
      { "kind": "check", "t": 7.9, "note": "Scroll #3: no skeleton, first question still in place" }
    ] }
]
```

A single upload carries them in metadata:

```bash
lh acceptance run evidence upload --check "$CHECK_RESULT_ID" --type video \
  --file ./proof/scroll-top.mp4 --desc "Five scrolls at the top of a short topic" \
  --metadata "{\"chapters\": $(cat ./proof/flow.chapters.json)}"
```

Ingest warns and drops every malformed marker — a negative or missing `t`, an
unknown `kind`, a `step` without a `label`, a `check`/`flag` without a `note` —
and ignores chapters on anything that is not a video. Treat the warning as a
claim the reviewer will not see: fix it and re-ingest before handing off.
Chapters need `lh` 0.0.60 or later (`lh --version`); an older CLI uploads the
video without them, so read the evidence back and confirm they arrived.

## When the reviewer answers on the timeline

A reject on a video names its moment. `lh acceptance feedback <id> --actionable`
prints each note with `frame at 0:07.47` (optionally with the circled region),
a span such as `0:06.48–0:07.78`, and — when the reviewer disputed one of your
chapters — `disputes your check at 0:07.90: "<your note>"`. Open the recording
at that moment before acting:

```bash
ffmpeg -ss 7.47 -i ./proof/scroll-top.mp4 -frames:v 1 ./review/frame-7.47.png
```

A disputed `check` means that claim was judged wrong: find what the frame (or
the frames around it) actually shows, and do not repeat the claim in the next
round without new evidence.
