# Content Generation Commands

Generate text, images, videos, speech, and transcriptions.

**Source**: `apps/cli/src/commands/generate/`

## Command Structure

```
lh generate (alias: gen)
├── text <prompt>                    # Text generation
├── image <prompt>                   # Image generation
├── video <prompt>                   # Video generation
├── tts <text>                       # Text-to-speech
├── asr <audioFile>                  # Audio-to-text (speech recognition)
├── download <genId> <taskId>        # Wait & download generation result
├── status <genId> <taskId>          # Check async task status
└── list                             # List generation topics
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

Generate images from text prompt. This is an async operation — the command submits the task and returns a generation ID + task ID for tracking.

**Source**: `apps/cli/src/commands/generate/image.ts`

```bash
lh gen image "A sunset over mountains" [options]
lh gen image "A cute cat" --model dall-e-3 --provider openai --json
```

| Option                      | Description      | Default    |
| --------------------------- | ---------------- | ---------- |
| `-m, --model <model>`       | Model ID         | `dall-e-3` |
| `-p, --provider <provider>` | Provider name    | `openai`   |
| `-n, --num <n>`             | Number of images | `1`        |
| `--width <px>`              | Width in pixels  | -          |
| `--height <px>`             | Height in pixels | -          |
| `--steps <n>`               | Number of steps  | -          |
| `--seed <n>`                | Random seed      | -          |
| `--json`                    | Output raw JSON  | `false`    |

**Output** (non-JSON):

```
✓ Image generation started
  Batch ID: gb_xxx
  1 image(s) queued
  Generation gen_xxx → Task <taskId>

Use "lh generate status <generationId> <taskId>" to check progress.
```

**Typical workflow**:

```bash
# Generate image, then wait & download
lh gen image "A cute cat"
lh gen download <generationId> <taskId> -o cat.png
```

---

## `lh generate video <prompt>` / `lh gen video <prompt>`

Generate video from text prompt. This is an async operation.

**Source**: `apps/cli/src/commands/generate/video.ts`

```bash
lh gen video "A cat playing piano" -m < model > -p < provider > [options]
```

| Option                      | Description              | Required |
| --------------------------- | ------------------------ | -------- |
| `-m, --model <model>`       | Model ID                 | Yes      |
| `-p, --provider <provider>` | Provider name            | Yes      |
| `--aspect-ratio <ratio>`    | Aspect ratio (e.g. 16:9) | No       |
| `--duration <sec>`          | Duration in seconds      | No       |
| `--resolution <res>`        | Resolution (e.g. 720p)   | No       |
| `--seed <n>`                | Random seed              | No       |
| `--json`                    | Output raw JSON          | No       |

**Note**: Unlike image, video requires `-m` and `-p` (no defaults). Use `lh model list <provider> --type video` to find available video models.

**Output** (non-JSON):

```
✓ Video generation started
  Batch ID: gb_xxx
  Generation gen_xxx → Task <taskId>

Use "lh generate status <generationId> <taskId>" to check progress.
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

## `lh generate download <generationId> <taskId>`

Wait for an async generation task to complete and download the result file.

**Source**: `apps/cli/src/commands/generate/index.ts`

```bash
lh gen download <generationId> <taskId> [-o output.png]
lh gen download gen_xxx task_xxx -o ~/Desktop/result.mp4 --timeout 600
```

| Option                | Description                              | Default                |
| --------------------- | ---------------------------------------- | ---------------------- |
| `-o, --output <path>` | Output file path (auto-detect extension) | `<generationId>.<ext>` |
| `--interval <sec>`    | Polling interval in seconds              | `5`                    |
| `--timeout <sec>`     | Timeout in seconds (0 = no timeout)      | `300`                  |

**Behavior**:

1. Polls `generation.getGenerationStatus` at the specified interval
2. Shows live progress: `⋯ Status: processing... (42s)`
3. On success: downloads asset URL to local file
4. On error: displays error message and exits
5. On timeout: suggests using `lh gen status` to check later

**Typical workflow**:

```bash
# One-shot: generate and download
lh gen image "A sunset"
# Copy the generation ID and task ID from output
lh gen download gen_xxx taskId_xxx -o sunset.png

# Video (longer timeout)
lh gen video "A cat running" -m model -p provider
lh gen download gen_xxx taskId_xxx -o cat.mp4 --timeout 600
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

---

## Backend Architecture

Image and video generation use an async task pattern:

1. **Create topic** → `generationTopic.createTopic`
2. **Submit generation** → `image.createImage` / `video.createVideo`
   - Creates batch + generation + asyncTask records in a DB transaction
   - Triggers async background task (image via `createAsyncCaller`, video via `initModelRuntimeFromDB`)
   - Returns `{ data: { batch, generations }, success }` with `asyncTaskId` in each generation
3. **Poll status** → `generation.getGenerationStatus`
   - Returns `{ status, error, generation }` (generation includes asset URLs on success)

**Server routes**:

- `src/server/routers/lambda/image/index.ts` — image creation (uses `authedProcedure` + `serverDatabase`)
- `src/server/routers/lambda/video/index.ts` — video creation (uses `authedProcedure` + `serverDatabase`)
- `src/server/routers/lambda/generation.ts` — status checking

**Note**: Image/video routes do NOT use the `keyVaults` middleware — they read API keys from the database via `initModelRuntimeFromDB` or `createAsyncCaller`.
