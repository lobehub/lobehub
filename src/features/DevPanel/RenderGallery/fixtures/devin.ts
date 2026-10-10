'use client';

import { defineFixtures, single } from './_helpers';

const readFileText = `import { TraeAcpAdapter } from './traeAcp';

export class DevinAcpAdapter extends TraeAcpAdapter {
  protected readonly identifier = 'devin';
}`;

// Devin parks the raw ACP `tool_call_update` in pluginState, whose `content`
// is a content-block array rather than the plain strings lobe tools report.
const acpToolState = (kind: string, text: string) => ({
  content: [{ content: { text, type: 'text' }, type: 'content' }],
  kind,
  status: 'completed',
});

export default defineFixtures({
  identifier: 'devin',
  meta: {
    description:
      'Devin CLI tool previews. apiName comes from _meta["cognition.ai/inferenceToolName"] on ACP tool_call updates.',
    title: 'Devin',
  },
  apiList: [
    { description: 'Ask the user a question (permission prompts).', name: 'askUserQuestion' },
    { description: 'Edit a file by replacing matching content.', name: 'edit' },
    { description: 'Run a shell command.', name: 'exec' },
    { description: 'Read file content.', name: 'read' },
    { description: 'Write a new file.', name: 'write' },
  ],
  fixtures: {
    askUserQuestion: single({
      args: {
        questions: [
          {
            header: 'Permission',
            options: [
              { description: 'Run the command once.', label: 'Allow' },
              {
                description: 'Trust this command for the rest of the session.',
                label: 'Always allow',
              },
              { description: 'Skip this command.', label: 'Deny' },
            ],
            question: 'Devin wants to run `pnpm install`. Allow it?',
          },
        ],
      },
    }),
    edit: single({
      args: {
        file_path: 'packages/builtin-tools/src/register.ts',
        new_string: "const DEVIN_IDENTIFIER = 'devin';",
        old_string: "const DEVIN_IDENTIFIER = 'devin-cli';",
      },
      content: 'Applied edit to packages/builtin-tools/src/register.ts',
      pluginState: acpToolState('edit', 'Applied edit to packages/builtin-tools/src/register.ts'),
    }),
    exec: single({
      args: { command: 'bun run check packages/builtin-tools/src/register.ts' },
      content: '✓ 7 files · lint clean · tests 52 passed',
      pluginState: acpToolState('execute', '✓ 7 files · lint clean · tests 52 passed'),
    }),
    read: single({
      args: {
        file_path: 'packages/heterogeneous-agents/src/adapters/devinAcp.ts',
        limit: 4,
      },
      content: readFileText,
      pluginState: acpToolState('read', readFileText),
    }),
    write: single({
      args: {
        content: `import { defineFixtures, single } from './_helpers';\n\nexport default defineFixtures({\n  identifier: 'devin',\n});\n`,
        file_path: 'src/features/DevPanel/RenderGallery/fixtures/devin.ts',
      },
      content: 'Wrote src/features/DevPanel/RenderGallery/fixtures/devin.ts',
      pluginState: acpToolState('write', 'File written'),
    }),
  },
});
