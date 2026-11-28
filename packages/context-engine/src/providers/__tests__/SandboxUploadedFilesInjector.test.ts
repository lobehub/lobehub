import { describe, expect, it } from 'vitest';

import { MessagesEngine } from '../../engine/messages/MessagesEngine';
import type { LobeToolManifest } from '../../engine/tools/types';
import type { UIChatMessage } from '../../types';

const sandboxManifest: LobeToolManifest = {
  api: [
    {
      description: 'Run command',
      name: 'runCommand',
      parameters: { properties: {}, type: 'object' },
    },
  ],
  identifier: 'lobe-cloud-sandbox',
  meta: { title: 'Cloud Sandbox' },
  systemRole: 'Sandbox ready.\n\n{{sandbox_uploaded_files}}',
  type: 'builtin',
};

const user = (id: string, content: string): UIChatMessage =>
  ({ content, createdAt: 0, id, role: 'user', updatedAt: 0 }) as UIChatMessage;
const assistant = (id: string, content: string): UIChatMessage =>
  ({ content, createdAt: 0, id, role: 'assistant', updatedAt: 0 }) as UIChatMessage;

describe('SandboxUploadedFilesInjector (prompt cache stability)', () => {
  it('keeps message [0] and all earlier turns byte-identical when later user turns upload files', async () => {
    const run = (
      messages: UIChatMessage[],
      sandboxUploadedFilesByMessage?: Record<string, string>,
      systemUploadedFiles = '',
    ) =>
      new MessagesEngine({
        enableAgentMode: true,
        enableSystemDate: false,
        messages,
        model: 'claude-sonnet-5-5',
        provider: 'anthropic',
        sandboxUploadedFilesByMessage,
        systemRole: 'You are a helpful assistant.',
        toolsConfig: {
          manifests: [sandboxManifest],
          tools: [sandboxManifest.identifier],
        },
        variableGenerators: {
          sandbox_uploaded_files: () => systemUploadedFiles,
        },
      }).process();

    const turn1Messages = [user('u1', 'Let us prepare a Q4 report.')];
    const turn1 = await run(turn1Messages);

    const turn2Messages = [
      ...turn1Messages,
      assistant('a1', 'Sure, share your data whenever ready.'),
      user('u2', 'Here is the raw CSV.'),
    ];
    const u2UploadBlock =
      '<uploaded_files>\nThese user-uploaded files are pre-loaded and ready to use:\n- /mnt/data/report.csv (2KB)\n</uploaded_files>';
    const turn2 = await run(turn2Messages, { u2: u2UploadBlock });

    // Turn 1's system prompt and messages stay 100% byte-identical.
    expect(turn2.messages.slice(0, turn1.messages.length)).toEqual(turn1.messages);
    expect(turn2.messages[0].content).not.toContain('/mnt/data/report.csv');
    expect(turn2.messages.at(-1)!.content as string).toContain('<sandbox_uploaded_files>');
    expect(turn2.messages.at(-1)!.content as string).toContain('/mnt/data/report.csv');

    const turn3Messages = [
      ...turn2Messages,
      assistant('a2', 'Analyzed report.csv.'),
      user('u3', 'Now here is the slide template.'),
    ];
    const u3UploadBlock =
      '<uploaded_files>\nThese user-uploaded files are pre-loaded and ready to use:\n- /mnt/data/template.pptx (50KB)\n</uploaded_files>';
    const turn3 = await run(turn3Messages, { u2: u2UploadBlock, u3: u3UploadBlock });

    // Both Turn 1 and Turn 2 stay byte-identical when Turn 3 uploads another file.
    expect(turn3.messages.slice(0, turn2.messages.length)).toEqual(turn2.messages);
    expect(turn3.messages.at(-1)!.content as string).toContain('/mnt/data/template.pptx');
  });
});
