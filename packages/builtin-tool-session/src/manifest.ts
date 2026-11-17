import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { SessionApiName } from './types';

export const SessionIdentifier = 'lobe-session';

const topicId = {
  description: 'The sub-session (topic) id, as startSession or listSessions returned it.',
  type: 'string',
};

export const SessionManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Open a sub-session: a new, separate conversation (topic) that runs on its own, listed under this conversation, which the user can open, follow and continue. Returns immediately with its topic id; when each of its turns ends, its reply is reported back here and wakes you. Use it for independent work that should not happen inside this conversation, for parallel work, or to hand work to another agent. For a quick delegated step whose result you need in this turn, prefer a sub-agent instead.',
      humanIntervention: 'required',
      name: SessionApiName.startSession,
      parameters: {
        additionalProperties: false,
        properties: {
          agentId: {
            description:
              'Agent to run the sub-session (any agent, including Claude Code or Codex agents). Omit for yourself.',
            type: 'string',
          },
          baseBranch: {
            description: 'With workspace "new-worktree": the branch to fork from. Omit for HEAD.',
            type: 'string',
          },
          deviceId: {
            description: "Device to run on. Omit to use this conversation's device.",
            type: 'string',
          },
          prompt: {
            description:
              'The first message: a self-contained brief with the goal, the relevant context, and what done looks like. The sub-session does not see this conversation.',
            type: 'string',
          },
          title: { description: 'Short title (under 60 characters).', type: 'string' },
          workspace: {
            description:
              '"inherit" (default): work in this conversation\'s directory, sharing uncommitted files. "new-worktree": a fresh git worktree and branch cut from this conversation\'s repository, so changes stay isolated. "none": no working directory (the agent\'s own default); it still runs on this conversation\'s device.',
            enum: ['inherit', 'new-worktree', 'none'],
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
    },
    {
      description: 'List the sub-sessions this conversation opened, with their state.',
      name: SessionApiName.listSessions,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description:
        "A sub-session's state (running, waiting_for_user, idle, failed) and its last reply.",
      name: SessionApiName.getSession,
      parameters: {
        additionalProperties: false,
        properties: { topicId },
        required: ['topicId'],
        type: 'object',
      },
    },
    {
      description: "Read a sub-session's latest messages.",
      name: SessionApiName.readSession,
      parameters: {
        additionalProperties: false,
        properties: {
          limit: { description: 'How many of the latest messages (default 30).', type: 'number' },
          topicId,
        },
        required: ['topicId'],
        type: 'object',
      },
    },
    {
      description:
        "Send a message to a sub-session. Starts a turn when it is idle; while it is running, the message follows the user's follow-up setting (queued for the next turn, or steered into the current one). Never interrupts.",
      name: SessionApiName.sendToSession,
      parameters: {
        additionalProperties: false,
        properties: { message: { type: 'string' }, topicId },
        required: ['topicId', 'message'],
        type: 'object',
      },
    },
    {
      description: "Stop a sub-session's current turn. A stopped turn is not reported back.",
      name: SessionApiName.stopSession,
      parameters: {
        additionalProperties: false,
        properties: { topicId },
        required: ['topicId'],
        type: 'object',
      },
    },
    {
      description:
        'Archive a finished sub-session. Its own sub-sessions move to the top level; its worktree, if the app created one, is cleaned up.',
      humanIntervention: 'required',
      name: SessionApiName.archiveSession,
      parameters: {
        additionalProperties: false,
        properties: { topicId },
        required: ['topicId'],
        type: 'object',
      },
    },
  ],
  identifier: SessionIdentifier,
  meta: {
    avatar: '🗂️',
    description: 'Open and manage sub-sessions: separate conversations this one starts',
    title: 'Sub-sessions',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
