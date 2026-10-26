const content = `# lh gen - Content Generation

Generate text, images, videos, and audio. Alias: \`lh generate\`.

## Subcommands

- \`lh gen text <prompt> [-m <model>] [-p <provider>] [--temperature <t>]\` - Generate text
- \`lh gen json <prompt> [-m <model>] [-p <provider>] [--schema <json|file>] [--schema-name <name>] [--strict]\` - Generate a JSON object (structured output)
- \`lh gen image <prompt> [-m <model>] [-n <count>] [--width <w>] [--height <h>]\` - Generate image
- \`lh gen video <prompt> -m <model> -p <provider> [--aspect-ratio <r>] [--duration <d>] [--resolution <res>]\` - Generate video
- \`lh gen tts <text> [-m <model>] [-p <provider>] [-o <output>] [--voice <v>] [--speed <s>]\` - Text-to-speech using the selected provider's saved configuration
- \`lh gen asr <audioFile> [--model <m>] [--language <l>]\` - Speech-to-text
- \`lh gen status <generationId> <asyncTaskId>\` - Check generation task status
- \`lh gen download <generationId> <asyncTaskId> [-o <output>]\` - Wait and download result
- \`lh gen list\` - List generation topics

## Structured Output

\`lh gen json\` returns a parsed JSON object instead of text. \`--schema\` is required — the server needs a
schema, so pass one inline or as a file.

\`\`\`bash
# Inline schema
lh gen json "Extract the person" --schema '{"properties":{"name":{"type":"string"}},"required":["name"],"type":"object"}'

# Schema from a file, named and strictly enforced
lh gen json "Extract the person" --schema ./person.json --schema-name person --strict
\`\`\`

- The command prints the pretty-printed object; a reply the server cannot parse into the schema exits with code 1
- The server keeps only \`type\`, \`properties\`, \`required\`, \`additionalProperties\` and \`$defs\`, so schemas using \`allOf\`, \`minProperties\` or \`patternProperties\` are rejected
- It is a single request: \`--stream\`, \`--temperature\` and \`--max-tokens\` are not accepted options
- Use \`lh gen text\` when you want prose

## Tips

- Image/video generation is async; use \`status\` or \`download\` to get results
- Text generation returns the complete response, without incremental streaming
- \`--pipe\` for text generation outputs only the raw text (no formatting)

## Finding Available Video / Image Models

Before generating, always look up the correct model ID with \`lh model list\`:

\`\`\`bash
# List all video models for the lobehub provider
lh model list lobehub --type video

# List only enabled video models
lh model list lobehub --type video --enabled

# List image generation models
lh model list lobehub --type image
\`\`\`

Use the \`id\` field from the output as the \`-m\` argument. Model IDs for video/image are
**not** the same as human-readable display names — always use the exact \`id\` field.

Example:
\`\`\`bash
# ✅ Correct — use the id from lh model list
lh gen video "a cat riding a skateboard" -p lobehub -m dreamina-seedance-2-0-260128

# ❌ Wrong — guessed slugs will fail with no_valid_channel_error
lh gen video "a cat riding a skateboard" -p lobehub -m seedance-2.0
\`\`\`

## ⚠️ asyncTaskId vs generationId

\`gen status\` and \`gen download\` require TWO different IDs:

- \`<generationId>\` — prefixed with \`gen_\`, e.g. \`gen_abc123\`
- \`<asyncTaskId>\` — a UUID printed after \`→ Task\` in the \`gen image\` / \`gen video\` output,
  e.g. \`7ad0eb13-e9a5-4403-8070-1f7fe95b2f95\`

Passing \`gen_xxx\` as \`<asyncTaskId>\` will cause a server error. Always use the UUID.

Example output from \`lh gen video\`:
\`\`\`
✓ Video generation started
  Batch ID: gb_xxx
  Generation gen_abc123 → Task 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95
                               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ← this is asyncTaskId
\`\`\`

Correct usage:
\`\`\`bash
lh gen status gen_abc123 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95
lh gen download gen_abc123 7ad0eb13-e9a5-4403-8070-1f7fe95b2f95 -o result.mp4
\`\`\`
`;

export default content;
