const content = `# lh gen - Content Generation

Generate text, images, videos, and audio. Alias: \`lh generate\`.

## Subcommands

- \`lh gen text <prompt> [-m <model>] [-p <provider>] [--stream] [--temperature <t>]\` - Generate text
- \`lh gen image <prompt> [-m <model>] [-n <count>] [--width <w>] [--height <h>]\` - Generate image
- \`lh gen video <prompt> [-m <model>] [--aspect-ratio <r>] [--duration <d>]\` - Generate video
- \`lh gen tts <text> [-o <output>] [--voice <v>] [--speed <s>]\` - Text-to-speech
- \`lh gen asr <audioFile> [--model <m>] [--language <l>]\` - Speech-to-text
- \`lh gen status <generationId> <taskId>\` - Check generation task status
- \`lh gen download <generationId> <taskId> [-o <output>]\` - Wait and download result
- \`lh gen list\` - List generation topics

## Tips

- Image/video generation is async; use \`status\` or \`download\` to get results
- \`--stream\` for text generation outputs tokens as they arrive
- \`--pipe\` for text generation outputs only the raw text (no formatting)
`;

export default content;
