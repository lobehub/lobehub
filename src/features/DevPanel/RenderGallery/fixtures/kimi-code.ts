'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'kimi-code',
  meta: {
    description: 'Kimi Code 0.38.0 native tool previews captured from local stream-json traces.',
    title: 'Kimi Code',
  },
  apiList: [
    { description: 'Delegate a focused task to a Kimi Code sub-agent.', name: 'Agent' },
    { description: 'Run a shell command.', name: 'Bash' },
    { description: 'Replace matching content in a file.', name: 'Edit' },
    { description: 'Fetch and extract a web page.', name: 'FetchURL' },
    { description: 'Find files by glob pattern.', name: 'Glob' },
    { description: 'Search file contents.', name: 'Grep' },
    { description: 'Read file content.', name: 'Read' },
    { description: 'Load a Kimi Code skill.', name: 'Skill' },
    { description: 'Search the web.', name: 'WebSearch' },
    { description: 'Write a new file.', name: 'Write' },
  ],
  fixtures: {
    Agent: single({
      args: {
        description: 'Inspect the tool rendering pipeline',
        prompt: 'Locate the builtin tool registry and summarize how renderers are resolved.',
        subagent_type: 'explore',
      },
      content:
        'The renderer is resolved by identifier and API name in `packages/builtin-tools/src/renders.ts`, then mounted by the conversation tool card.',
    }),
    Bash: single({
      args: { command: 'bun run check packages/builtin-tools/src/kimiCode' },
      content: '✓ 4 files · lint clean · tests 2 passed',
      pluginState: {
        exitCode: 0,
        output: '✓ 4 files · lint clean · tests 2 passed',
        stdout: '✓ 4 files · lint clean · tests 2 passed',
        success: true,
      },
    }),
    Edit: single({
      args: {
        new_string: "const KIMI_CODE_IDENTIFIER = 'kimi-code';",
        old_string: "const KIMI_IDENTIFIER = 'kimi';",
        path: 'packages/builtin-tools/src/register.ts',
      },
      content: 'Replaced 1 occurrence in packages/builtin-tools/src/register.ts',
    }),
    FetchURL: single({
      args: { url: 'https://github.com/MoonshotAI/kimi-code' },
      content:
        '# Kimi Code CLI\n\nKimi Code CLI is an AI coding agent that runs in your terminal. It can read and edit code, run shell commands, search files, fetch web pages, and delegate focused tasks.',
    }),
    Glob: single({
      args: { pattern: 'packages/**/*kimi*/**/*.ts' },
      content:
        'packages/heterogeneous-agents/src/adapters/kimiCode.ts\npackages/heterogeneous-agents/src/adapters/kimiCode.test.ts',
    }),
    Grep: single({
      args: {
        output_mode: 'content',
        path: 'packages/heterogeneous-agents/src/adapters/kimiCode.ts',
        pattern: 'parseToolCalls',
      },
      content:
        '98:    const calls = this.parseToolCalls(event.tool_calls);\n181:  private parseToolCalls(value: unknown): ToolCallPayload[] {',
    }),
    Read: single({
      args: { n_lines: 8, path: 'packages/heterogeneous-agents/src/adapters/kimiCode.ts' },
      content:
        "1\timport type { AgentEventAdapter } from '../types';\n2\t\n3\tconst KIMI_CODE_IDENTIFIER = 'kimi-code';\n4\t\n5\texport class KimiCodeAdapter implements AgentEventAdapter {",
    }),
    Skill: single({
      args: { skill: 'deep-review' },
      content: 'Skill "deep-review" loaded inline. Follow its review checklist.',
    }),
    WebSearch: single({
      args: { query: 'Kimi Code official GitHub repository' },
      content:
        'Title: GitHub - MoonshotAI/kimi-code\nSite: GitHub\nURL: https://github.com/MoonshotAI/kimi-code\nSnippet: Kimi Code CLI is an AI coding agent that runs in your terminal.',
    }),
    Write: single({
      args: {
        content: '# Kimi Code tool UI\n\nInspector and Render coverage for native tools.\n',
        path: 'docs/kimi-code-tool-ui.md',
      },
      content: 'Wrote 73 bytes to docs/kimi-code-tool-ui.md',
    }),
  },
});
