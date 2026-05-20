# @lobechat/prompts

This package contains prompt chains and templates for the LobeHub application.

## Features

- **Prompt Chains**: Reusable prompt templates for various AI tasks
- **Multi-language Support**: Prompts for multiple languages
- **Type Safety**: Full TypeScript support with proper type definitions

## Available Prompt Chains

- `chainSummaryTitle` - Generate conversation titles
- `chainLangDetect` - Detect language of input text
- `chainTranslate` - Translate content between languages
- `chainPickEmoji` - Select appropriate emojis for content
- `chainAnswerWithContext` - Answer questions using knowledge base context
- `chainAbstractChunkText` - Summarize text chunks

## Testing

Prompt evaluation tests are located in `devtools/agent-evals/scenarios/prompt-chain/` (cloud repo) and run via the agent-evals CLI.

```bash
# Run from cloud repo root
bun run agent-evals run prompt-chain/translate
bun run agent-evals run prompt-chain/emoji-picker
bun run agent-evals list # See all available scenarios
```

## Development

```bash
# Run unit tests
pnpm test
```

## Architecture

```
src/
├── chains/           # Prompt chain implementations
├── prompts/          # Prompt templates and utilities
└── index.ts          # Main exports
```
