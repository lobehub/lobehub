# Cross-surface evidence contract

This reference defines the artifact contract shared by every surface. Capture
commands belong to the selected surface guide; do not load another surface's
instructions merely to learn how to submit an artifact.

## Evidence media

| Type           | Use when                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `text`         | Command output, logs, focused request/response data, or computed assertions prove the criterion   |
| `markdown`     | Reviewer-facing prose (a reasoning write-up, structured findings) should render as body text      |
| `dom_snapshot` | Structured content is stronger and smaller than pixels                                            |
| `screenshot`   | A settled visual state, layout, or native rendering is the claim                                  |
| `gif`          | A short temporal state should render inline, usually no more than about 10 seconds                |
| `video`        | A longer animation, transition, gesture, or multi-step flow needs a player and better compression |
| `audio`        | The deliverable is something the user **hears** — TTS output, a voice reply, an alert tone        |
| `transcript`   | A conversation, event stream, or request log is itself the proof                                  |

The declared `requiredEvidence` type is binding. Do not replace a required video
with a final screenshot or a required DOM snapshot with prose.

## Audio deliverables

A sound cannot be verified in prose, and a waveform screenshot proves only that
a file exists. Upload the clip itself with `--type audio` and the acceptance
page gives the reviewer a player.

```bash
# The generated file is the evidence — attach the artifact the feature produced,
# not a re-encode and not a screenshot of the player.
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" \
  --type audio --file ./out/tts-zh-female.mp3 --by program \
  --desc "TTS output for 「今天天气不错」, zh-CN female voice, 2.4s"
```

- `mp3` / `wav` / `m4a` / `aac` / `flac` / `ogg` / `opus` are recognized by
  extension, so `acceptance run ingest` types them as `audio` automatically.
- **Listen before citing it.** Confirm the clip is non-silent and is the right
  content (duration + a transcription pass, or a spectral check) — an empty or
  truncated file looks identical to a good one in the file list.
- Pair the clip with a short `text` artifact when the claim is about _what was
  said_ (the input text, the voice/model, the measured duration). The player
  proves it plays; the text artifact makes it auditable.
- Capture what the product produced. A screen recording with system audio is a
  fallback for "the UI plays it at the right moment" — for "the output is
  correct", attach the file itself.

## Dual text evidence for non-visual behavior

CLI, API, backend, policy, security, and migration claims normally need two
separate `text` artifacts on the same check:

1. A reasoning artifact: claim, setup or threat model, method, pass criteria,
   interpretation, and limitations.
2. An execution artifact: exact command or request, relevant raw observations,
   exit/status values, and a short mapping back to the pass criteria.

Keep both artifacts in the current immutable round. Do not ask a reviewer to
join an explanation from an older round with fresh execution output.

## File versus inline content

- Use `--file` for binary artifacts and larger text/DOM/transcript files.
- Use `--content` for short text assertions. Pass exactly one of `--file` and
  `--content`.
- Keep the description factual: identify the action, observed state, and relevant
  target. Do not place the verdict in the description unless explicitly asked.

```bash
# File artifact captured by the selected surface.
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" \
  --type "$EVIDENCE_TYPE" --file "$ARTIFACT_PATH" --by "$PROVENANCE" \
  --desc "Observed state after the planned action"

# Short text assertion.
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" \
  --type text --content "$ASSERTION_OUTPUT" --by cli \
  --desc "Machine-readable assertion output"
```

## Provenance (`--by`)

Set `--by` to the producer named by the selected surface guide. Use the direct
capture source for an unmodified artifact and `program` for a deterministic test,
script, or media transform. Do not infer provenance from the file extension.

## Artifact safety

- Inspect every image, clip, and generated document before citing it.
- Never upload credentials, cookies, tokens, private user data, unrelated host
  windows, or notifications.
- Prefer a focused artifact over an unfiltered log or full-session recording.
- Retain the raw source when submitting a derived chart, contact sheet, GIF, or
  edited comparison image.
