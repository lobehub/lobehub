import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ProjectApiName, ProjectIdentifier, SANDBOX_RUNNER_ID } from './types';

export const ProjectManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "List the project's runners in priority order (the cloud sandbox and device workspace folders) with live presence, mark the one this conversation runs on, and list the devices that could be added as runners.",
      name: ProjectApiName.listRunners,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description:
        'Read the environment every runner prepares: repositories, setup command, variable names (never values) and run notes.',
      name: ProjectApiName.getEnvironment,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description:
        'Edit the environment. Only the parts given change: add or remove repositories, set the setup command or the run notes ("" clears them). Affects every runner of the project.',
      humanIntervention: 'required',
      name: ProjectApiName.updateEnvironment,
      parameters: {
        additionalProperties: false,
        properties: {
          addRepositories: {
            description: 'Repositories to add.',
            items: {
              additionalProperties: false,
              properties: {
                ref: { description: 'Branch or tag; omit for the default branch.', type: 'string' },
                url: { description: 'https://github.com/<owner>/<repo>', type: 'string' },
              },
              required: ['url'],
              type: 'object',
            },
            type: 'array',
          },
          notes: {
            description: 'Free-text run notes on what a run needs from a machine.',
            type: 'string',
          },
          removeRepositories: {
            description: 'URLs of repositories to remove.',
            items: { type: 'string' },
            type: 'array',
          },
          setupCommand: {
            description: 'Shell command every runner runs after checking out the repositories.',
            type: 'string',
          },
        },
        type: 'object',
      },
    },
    {
      description:
        'Add a device and a workspace folder on it as a runner, last in priority. The folder must exist on the device; get deviceId from listRunners.',
      humanIntervention: 'required',
      name: ProjectApiName.addRunner,
      parameters: {
        additionalProperties: false,
        properties: {
          deviceId: { type: 'string' },
          path: { description: 'Absolute path of the folder on the device.', type: 'string' },
        },
        required: ['deviceId', 'path'],
        type: 'object',
      },
    },
    {
      description:
        'Remove a device runner from the project. Files on the device are kept. Refused while a conversation in that folder is running.',
      humanIntervention: 'required',
      name: ProjectApiName.removeRunner,
      parameters: {
        additionalProperties: false,
        properties: { runnerId: { description: 'A runner id from listRunners.', type: 'string' } },
        required: ['runnerId'],
        type: 'object',
      },
    },
    {
      description: `Set the runners' priority, which a new conversation follows. Pass every runner id from listRunners in the new order, "${SANDBOX_RUNNER_ID}" for the cloud sandbox.`,
      humanIntervention: 'required',
      name: ProjectApiName.reorderRunners,
      parameters: {
        additionalProperties: false,
        properties: {
          runnerIds: { items: { type: 'string' }, minItems: 1, type: 'array' },
        },
        required: ['runnerIds'],
        type: 'object',
      },
    },
  ],
  identifier: ProjectIdentifier,
  meta: {
    avatar: '📁',
    description: "Read and change the project's runners and environment",
    title: 'Project',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
