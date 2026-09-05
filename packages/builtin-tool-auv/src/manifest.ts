import { type BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { AuvApiName, AuvIdentifier } from './types';

export const AuvManifest: BuiltinToolManifest = {
  executors: ['client', 'server'],
  api: [
    {
      defaultTimeoutMs: 120_000,
      description:
        'Run a typed AUV CLI invoke command on the active desktop device. Pass arguments after the auv executable, for example ["invoke", "display.list"]. Use ["invoke", "--help"] or ["invoke", "display.capture", "--help"] to inspect available commands and options. Successful invocations return parsed JSON, including artifacts[].file_path for captured images.',
      humanIntervention: 'required',
      name: AuvApiName.runCommand,
      parameters: {
        properties: {
          argv: {
            description:
              'Arguments after the auv executable. The first argument must be "invoke". Do not include shell syntax or the executable name.',
            items: { type: 'string' },
            minItems: 2,
            type: 'array',
          },
        },
        required: ['argv'],
        type: 'object',
      },
    },
  ],
  identifier: AuvIdentifier,
  meta: {
    avatar: '🛰️',
    description: 'Run typed native computer-use commands through the private AUV CLI',
    readme:
      'AUV runs as an app-owned child process. LobeHub invokes its typed CLI over private local IPC and can pass image artifact paths to Local System readFile for visual analysis.',
    title: 'AUV',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
