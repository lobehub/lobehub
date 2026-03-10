# Content Generation Commands

Generate text, images, videos, speech, and transcriptions.

**Source**: `apps/cli/src/commands/generate/`

## Command Structure

```
lh generate (alias: gen)
├── text <prompt>      # Text generation
├── image <prompt>     # Image generation
├── video <prompt>     # Video generation
├── tts <text>         # Text-to-speech
├── asr <audioFile>    # Audio-to-text (speech recognition)
├── status <genId> <taskId>   # Check async task status
└── list               # List generation topics
```

---

## `lh generate text <prompt>` / `lh gen text <prompt>`

Generate text completion.

**Source**: `apps/cli/src/commands/generate/text.ts`

```bash
lh gen text "Explain quantum computing" [options]
echo "context" | lh gen text "summarize" --pipe
```

| Option                      | Description                        | Default              |
| --------------------------- | ---------------------------------- | -------------------- |
| `-m, --model <model>`       | Model ID                           | `openai/gpt-4o-mini` |
| `-p, --provider <provider>` | Provider name                      | -                    |
| `-s, --system <prompt>`     | System prompt                      | -                    |
| `--temperature <n>`         | Temperature (0-2)                  | -                    |
| `--max-tokens <n>`          | Maximum output tokens              | -                    |
| `--stream`                  | Enable streaming output            | `false`              |
| `--json`                    | Output full JSON response          | `false`              |
| `--pipe`                    | Read additional context from stdin | `false`              |

### Pipe Mode

When `--pipe` is used, reads stdin and prepends it to the prompt. Useful for piping file contents:

```bash
cat README.md | lh gen text "summarize this" --pipe
```

---

## `lh generate image <prompt>` / `lh gen image <prompt>`

Generate images from text prompt.

**Source**: `apps/cli/src/commands/generate/image.ts`

```bash
lh gen image "A sunset over mountains" [options]
```

Options follow same pattern as text generation with image-specific model defaults.

---

## `lh generate video <prompt>` / `lh gen video <prompt>`

Generate video from text prompt.

**Source**: `apps/cli/src/commands/generate/video.ts`

```bash
lh gen video "A cat playing piano" [options]
```

---

## `lh generate tts <text>` / `lh gen tts <text>`

Text-to-speech generation.

**Source**: `apps/cli/src/commands/generate/tts.ts`

```bash
lh gen tts "Hello, world!" [options]
```

---

## `lh generate asr <audioFile>` / `lh gen asr <audioFile>`

Audio-to-text transcription (Automatic Speech Recognition).

**Source**: `apps/cli/src/commands/generate/asr.ts`

```bash
lh gen asr recording.wav [options]
```

---

## `lh generate status <generationId> <taskId>`

Check the status of an async generation task.

```bash
lh gen status <generationId> <taskId> [--json]
```

| Option   | Description              |
| -------- | ------------------------ |
| `--json` | Output raw JSON response |

**Displays**:

- Status (color-coded): `success` (green), `error` (red), `processing` (yellow), `pending` (cyan)
- Error message (if failed)
- Asset URL and thumbnail URL (if completed)

---

## `lh generate list`

List all generation topics.

```bash
lh gen list [--json [fields]]
```

**Table columns**: ID, TITLE, TYPE, UPDATED
