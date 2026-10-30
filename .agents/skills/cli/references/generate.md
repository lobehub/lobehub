# Content Generation Commands

Generate text, images, videos, speech, and transcriptions.

**Source**: `apps/cli/src/commands/generate/`

## Command Structure

```
lh generate (alias: gen)
├── text <prompt>                          # Text generation
├── json <prompt>                          # Structured output (JSON Schema)
├── decide [state]                         # Decision model: typed questions → probabilities
├── image <prompt>                         # Image generation
├── image-params                           # Parameters an image model accepts
├── video <prompt>                         # Video generation
├── tts <text>                             # Text-to-speech
├── asr <audio-file>                       # Audio-to-text (speech recognition)
├── download <generationId> <asyncTaskId>  # Wait & download generation result
├── status <generationId> <asyncTaskId>    # Check async task status
├── delete <generationId>                  # Delete a generation record
└── list                                   # List generation topics
```

> ⚠️ **Important**: `status` and `download` require an `asyncTaskId` (UUID format, e.g.
> `7ad0eb13-e9a5-4403-8070-1f7fe95b2f95`), **not** the generation ID (`gen_xxx`).
> The asyncTaskId is printed after "→ Task" in the `video` / `image` command output.

---

## `lh generate text <prompt>` / `lh gen text <prompt>`

Generate a complete text response. Incremental streaming is not supported; the agent
gateway WebSocket handles agent operations, not this single-completion endpoint.

**Source**: `apps/cli/src/commands/generate/text.ts`

```bash
lh gen text <prompt> [-m <model>] [-p <provider>] [-s <prompt>] [--temperature <n>] [--max-tokens <n>] [--json] [--pipe]
```

```bash
echo "context" | lh gen text "summarize" --pipe
```

| Option                      | Description                        | Default              |
| --------------------------- | ---------------------------------- | -------------------- |
| `-m, --model <model>`       | Model ID                           | `openai/gpt-4o-mini` |
| `-p, --provider <provider>` | Provider name                      | -                    |
| `-s, --system <prompt>`     | System prompt                      | -                    |
| `--temperature <n>`         | Temperature (0-2)                  | -                    |
| `--max-tokens <n>`          | Maximum output tokens              | -                    |
| `--json`                    | Output full JSON response          | `false`              |
| `--pipe`                    | Read additional context from stdin | `false`              |

### Pipe Mode

When `--pipe` is used, reads stdin and prepends it to the prompt. Useful for piping file contents:

```bash
cat README.md | lh gen text "summarize this" --pipe
```

---

## `lh generate json <prompt>` / `lh gen json <prompt>`

Generate a JSON object with structured output.

**Source**: `apps/cli/src/commands/generate/json.ts`

```bash
lh gen json <prompt> [-m <model>] [-p <provider>] [-s <prompt>] [--schema <json|path>] [--schema-name <name>] [--strict] [--pipe]
```

| Option                      | Description                                        | Default              |
| --------------------------- | -------------------------------------------------- | -------------------- |
| `-m, --model <model>`       | Model ID                                           | `openai/gpt-4o-mini` |
| `-p, --provider <provider>` | Provider name                                      | -                    |
| `-s, --system <prompt>`     | System prompt                                      | -                    |
| `--schema <json\|path>`     | JSON Schema, inline or from a file (required)      | -                    |
| `--schema-name <name>`      | Schema name sent to the model                      | `response`           |
| `--strict`                  | Require the model to adhere strictly to the schema | `false`              |
| `--pipe`                    | Read additional context from stdin                 | `false`              |

The command calls the `aiChat.outputJSON` mutation rather than `/webapi/chat`, so the server owns
provider-specific handling (`json_schema` support, the tool-calling fallback, Responses API routing), and
prints the parsed object pretty-printed. It is a single request: `--stream`, `--temperature` and
`--max-tokens` are not accepted options, and passing them fails as an unknown option. A reply the server
cannot parse into the schema exits with code 1. The server keeps only `type`, `properties`, `required`,
`additionalProperties` and `$defs`; schemas using other root keywords (`allOf`, `minProperties`, ...) are
rejected up front.

---

## `lh generate decide [state]` / `lh gen decide [state]`

Ask a decision model (e.g. Jev) typed questions about one state. Each answer comes back as a probability,
not generated text: `boolean` → `probability`, `choice` → the picked option with `probabilities`, `score`
→ a rubric level.

**Source**: `apps/cli/src/commands/generate/decide.ts`

```bash
lh gen decide [state] -m <model> -q <json|path> [-p <provider>] [--state-file <path>] [--pipe]
```

```bash
lh gen decide "Newest message: is the queue mode ready?" -m lobehub/jev-1.14.0 \
  -q '{"addressed":{"type":"boolean","instructions":"Is the message directed at the assistant?"}}'
```

| Option                         | Description                                                             | Default |
| ------------------------------ | ----------------------------------------------------------------------- | ------- |
| `-m, --model <model>`          | Decision model ID, `provider/model` (required)                          | -       |
| `-p, --provider <provider>`    | Provider name                                                           | -       |
| `-q, --questions <json\|path>` | Question name → `{type, instructions, criteria}`, inline or from a file | -       |
| `--state-file <path>`          | Read the state from a file instead of the argument                      | -       |
| `--pipe`                       | Read the state (or more of it) from stdin                               | `false` |

Question shapes mirror `DecisionQuestion` in `@lobechat/model-runtime`: `boolean` takes optional
`criteria: {true, false}`, `choice` takes `criteria: {option: guidance | null}`, `score` takes
`criteria: [level0, level1, ...]`. The command calls the `aiChat.decide` mutation, the same
`runtime.decide` path bot wake and channel routing use, so a prompt can be replayed on the production
model. A provider without a decision endpoint fails with `CapabilityNotSupported` and exit code 1.

---

## `lh generate image <prompt>` / `lh gen image <prompt>`

Generate images from text prompt. This is an async operation — the command submits the task and returns a generation ID + async task ID for tracking.

**Source**: `apps/cli/src/commands/generate/image.ts`

```bash
lh gen image <prompt> [-m <model>] [-p <provider>] [-n <n>] [--param <key=value>...] [--width <px>] [--height <px>] [--steps <n>] [--seed <n>] [--json]
```

```bash
lh gen image "A cute cat" --model dall-e-3 --provider openai --json
lh gen image "A cute cat" -m gpt-image-2.5 -p lobehub --param size=1536x1024 --param quality=high
```

Parameters are model-specific: list them with `lh gen image-params -m <model> -p <provider>`. The server rejects parameters the model does not declare (for example `width`/`height` on gpt-image models, which take `size`) and empty prompts, before the task is queued or charged.

| Option                      | Description                                                    | Default    |
| --------------------------- | -------------------------------------------------------------- | ---------- |
| `-m, --model <model>`       | Model ID                                                       | `dall-e-3` |
| `-p, --provider <provider>` | Provider name                                                  | `openai`   |
| `-n, --num <n>`             | Number of images                                               | `1`        |
| `--param <key=value>`       | Model parameter, repeatable; values parse as JSON, else string | -          |
| `--width <px>`              | Shortcut for `--param width=<px>`                              | -          |
| `--height <px>`             | Shortcut for `--param height=<px>`                             | -          |
| `--steps <n>`               | Shortcut for `--param steps=<n>`                               | -          |
| `--seed <n>`                | Shortcut for `--param seed=<n>`                                | -          |
| `--json`                    | Output raw JSON                                                | `false`    |

**Output** (non-JSON):

```
✓ Image generation started
  Batch ID: gb_xxx
  1 image(s) queued
  Generation gen_xxx → Task 7ad0eb13-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                            This is the asyncTaskId — use this for status/download

Use "lh generate status <generationId> <asyncTaskId>" to check progress.
```

**Typical workflow**:

```bash
# 1. Submit generation — note down BOTH IDs from the output
lh gen image "A cute cat"
#   Generation gen_abc123 → Task 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95

# 2. Wait & download using generationId + asyncTaskId (the UUID)
lh gen download gen_abc123 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95 -o cat.png
```

---

## `lh generate image-params` / `lh gen image-params`

Show the parameters an image model declares, with allowed values and defaults.

**Source**: `apps/cli/src/commands/generate/image.ts`

```bash
lh gen image-params -m <model> -p <provider> [--json]
```

| Option                      | Description                     | Required |
| --------------------------- | ------------------------------- | -------- |
| `-m, --model <model>`       | Model ID                        | Yes      |
| `-p, --provider <provider>` | Provider name                   | Yes      |
| `--json`                    | Output the raw parameter schema | No       |

---

## `lh generate video <prompt>` / `lh gen video <prompt>`

Generate video from text prompt. This is an async operation.

**Source**: `apps/cli/src/commands/generate/video.ts`

```bash
lh gen video <prompt> -m <model> -p <provider> [--aspect-ratio <ratio>] [--duration <sec>] [--resolution <res>] [--seed <n>] [--image <url>] [--images <urls...>] [--end-image <url>] [--json]
```

| Option                      | Description                            | Required |
| --------------------------- | -------------------------------------- | -------- |
| `-m, --model <model>`       | Model ID                               | Yes      |
| `-p, --provider <provider>` | Provider name                          | Yes      |
| `--aspect-ratio <ratio>`    | Aspect ratio (e.g. 16:9)               | No       |
| `--duration <sec>`          | Duration in seconds                    | No       |
| `--resolution <res>`        | Resolution (e.g. 720p, 1080p)          | No       |
| `--seed <n>`                | Random seed                            | No       |
| `--image <url>`             | First-frame image URL (image-to-video) | No       |
| `--images <urls...>`        | Multiple reference image URLs          | No       |
| `--end-image <url>`         | Last-frame image URL                   | No       |
| `--json`                    | Output raw JSON                        | No       |

**Note**: Unlike image, video requires `-m` and `-p` (no defaults). Use `lh model list <provider> --type video` to find available video models.

**Output** (non-JSON):

```
✓ Video generation started
  Batch ID: gb_xxx
  Generation gen_xxx → Task 7ad0eb13-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                            This is the asyncTaskId — use this for status/download

Use "lh generate status <generationId> <asyncTaskId>" to check progress.
```

**Typical workflow**:

```bash
# 1. Find available video models for a provider
lh model list volcengine --json | grep -i seedance

# 2. Submit generation — note down BOTH IDs from the output
lh gen video "A cat on a runway" -m doubao-seedance-2-0-260128 -p volcengine \
  --aspect-ratio 9:16 --duration 5 --resolution 1080p
#   Generation gen_abc123 → Task 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95

# 3. Wait & download using generationId + asyncTaskId (the UUID)
lh gen download gen_abc123 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95 -o result.mp4 --timeout 600
```

---

## `lh generate tts <text>` / `lh gen tts <text>`

Text-to-speech generation.

**Source**: `apps/cli/src/commands/generate/tts.ts`

```bash
lh gen tts <text> [-o <file>] [--voice <voice>] [--speed <n>] [-m <model>] [-p <provider>]
```

| Option                      | Description                              | Default      |
| --------------------------- | ---------------------------------------- | ------------ |
| `-o, --output <file>`       | Output audio file path                   | `output.mp3` |
| `--voice <voice>`           | Voice name                               | `alloy`      |
| `--speed <n>`               | Speed multiplier (0.25-4.0)              | `1`          |
| `-m, --model <model>`       | Model ID (`provider/model` supported)    | `tts-1`      |
| `-p, --provider <provider>` | Provider (derived from model if omitted) | `openai`     |

Uses the selected provider's saved configuration through ModelRuntime, with the same
authenticated tRPC client as `lh gen asr`.

---

## `lh generate asr <audio-file>` / `lh gen asr <audio-file>`

Audio-to-text transcription (Automatic Speech Recognition). Accepts a local path or a URL.

**Source**: `apps/cli/src/commands/generate/asr.ts`

```bash
lh gen asr <audio-file> [--model <model>] [--provider <provider>] [--language <lang>] [--json]
```

```bash
lh gen asr recording.wav
```

| Option                  | Description                 | Default     |
| ----------------------- | --------------------------- | ----------- |
| `--model <model>`       | STT model                   | `whisper-1` |
| `--provider <provider>` | AI provider                 | `openai`    |
| `--language <lang>`     | Language code (e.g. en, zh) | -           |
| `--json`                | Output raw JSON             | -           |

---

## `lh generate download <generationId> <asyncTaskId>`

Wait for an async generation task to complete and download the result file.

**Source**: `apps/cli/src/commands/generate/index.ts`

> ⚠️ `<asyncTaskId>` is the UUID printed after "→ Task" in the video/image output.
> Do **not** pass the generation ID (`gen_xxx`) here — that will cause a server error.

```bash
lh gen download <generationId> <asyncTaskId> [-o <path>] [--interval <sec>] [--timeout <sec>]
```

```bash
lh gen download gen_xxx 7ad0eb13-xxxx-xxxx-xxxx-xxxxxxxxxxxx -o ~/Desktop/result.mp4 --timeout 600
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
4. On error / wrong ID: displays a clear message pointing to the correct ID format
5. On timeout: suggests using `lh gen status` to check later

---

## `lh generate status <generationId> <asyncTaskId>`

Check the status of an async generation task.

> ⚠️ `<asyncTaskId>` is the UUID printed after "→ Task" in the video/image output.
> Do **not** pass the generation ID (`gen_xxx`) here — that will cause a server error.

```bash
lh gen status <generationId> <asyncTaskId> [--json]
```

```bash
lh gen status gen_xxx 7ad0eb13-xxxx-xxxx-xxxx-xxxxxxxxxxxx
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
   - Input: `{ generationId, asyncTaskId }` — both are required, and `asyncTaskId` must be the
     UUID from the `async_tasks` table, not `gen_xxx`
   - Returns `{ status, error, generation }` (generation includes asset URLs on success)
   - Before querying, calls `checkTimeoutTasks` which marks tasks as `error` if they have been
     `pending` or `processing` for more than \~5 minutes (`ASYNC_TASK_TIMEOUT = 298s`)

**Server routes**:

- `apps/server/src/routers/lambda/image/index.ts` — image creation (uses `authedProcedure` + `serverDatabase`)
- `apps/server/src/routers/lambda/video/index.ts` — video creation (uses `authedProcedure` + `serverDatabase`)
- `apps/server/src/routers/lambda/generation.ts` — status checking
- `packages/database/src/models/asyncTask.ts` — `AsyncTaskModel` including `checkTimeoutTasks`

**Note**: Image/video routes do NOT use the `keyVaults` middleware — they read API keys from the database via `initModelRuntimeFromDB` or `createAsyncCaller`.
