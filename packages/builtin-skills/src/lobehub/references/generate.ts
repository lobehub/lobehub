const content = `# lh gen - Content Generation

Generate text, images, videos, and audio. Alias: \`lh generate\`.

## Subcommands

- \`lh gen text <prompt> [-m <model>] [-p <provider>] [--stream] [--temperature <t>]\` - Generate text
- \`lh gen image <prompt> [-m <model>] [-n <count>] [--width <w>] [--height <h>]\` - Generate image
- \`lh gen video <prompt> -m <model> -p <provider> [--aspect-ratio <r>] [--duration <d>] [--resolution <res>]\` - Generate video
- \`lh gen tts <text> [-o <output>] [--voice <v>] [--speed <s>]\` - Text-to-speech
- \`lh gen asr <audioFile> [--model <m>] [--language <l>]\` - Speech-to-text
- \`lh gen status <generationId> <asyncTaskId>\` - Check generation task status
- \`lh gen download <generationId> <asyncTaskId> [-o <output>]\` - Wait and download result
- \`lh gen list\` - List generation topics

## Tips

- Image/video generation is async; use \`status\` or \`download\` to get results
- \`--stream\` for text generation outputs tokens as they arrive
- \`--pipe\` for text generation outputs only the raw text (no formatting)

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
