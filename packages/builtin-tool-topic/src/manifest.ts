import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { TopicToolApiName } from './types';

export const TopicToolIdentifier = 'lobe-topic';

const topicId = {
  description: 'The sub-topic (topic) id, as openTopic or listTopics returned it.',
  type: 'string',
};

export const TopicToolManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Open a sub-topic: a new, separate conversation (topic) that runs on its own, listed under this conversation, which the user can open, follow and continue. Returns immediately with its topic id; when each of its turns ends, its reply is reported back here and wakes you. Use it for independent work that should not happen inside this conversation, for parallel work, or to hand work to another agent. For a quick delegated step whose result you need in this turn, prefer a sub-agent instead.',
      humanIntervention: 'required',
      name: TopicToolApiName.openTopic,
      parameters: {
        additionalProperties: false,
        properties: {
          agentId: {
            description:
              'Agent to run the sub-topic (any agent, including Claude Code or Codex agents). Omit for yourself.',
            type: 'string',
          },
          baseBranch: {
            description: 'With workspace "new-worktree": the branch to fork from. Omit for HEAD.',
            type: 'string',
          },
          detach: {
            description:
              'Open a plain, unlinked topic instead of a sub-topic: it is not listed under this conversation and never reports back. Use only when the user wants the new conversation to stand on its own. Not combined with workspace / baseBranch, which need the link.',
            type: 'boolean',
          },
          deviceId: {
            description: "Device to run on. Omit to use this conversation's device.",
            type: 'string',
          },
          prompt: {
            description:
              'The first message: a self-contained brief with the goal, the relevant context, and what done looks like. The sub-topic does not see this conversation.',
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
      description: 'List the sub-topics this conversation opened, with their state.',
      name: TopicToolApiName.listTopics,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description:
        "A sub-topic's state (running, waiting_for_user, idle, failed) and its last reply.",
      name: TopicToolApiName.getTopic,
      parameters: {
        additionalProperties: false,
        properties: { topicId },
        required: ['topicId'],
        type: 'object',
      },
    },
    {
      description: "Read a sub-topic's latest messages.",
      name: TopicToolApiName.readTopic,
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
        "Send a message to a sub-topic. Starts a turn when it is idle; while it is running, the message follows the user's follow-up setting (queued for the next turn, or steered into the current one). Never interrupts.",
      name: TopicToolApiName.sendToTopic,
      parameters: {
        additionalProperties: false,
        properties: { message: { type: 'string' }, topicId },
        required: ['topicId', 'message'],
        type: 'object',
      },
    },
    {
      description: "Stop a sub-topic's current turn. A stopped turn is not reported back.",
      name: TopicToolApiName.stopTopic,
      parameters: {
        additionalProperties: false,
        properties: { topicId },
        required: ['topicId'],
        type: 'object',
      },
    },
    {
      description:
        'Archive a finished sub-topic. Its own sub-topics move to the top level; its worktree, if the app created one, is cleaned up.',
      humanIntervention: 'required',
      name: TopicToolApiName.archiveTopic,
      parameters: {
        additionalProperties: false,
        properties: { topicId },
        required: ['topicId'],
        type: 'object',
      },
    },
  ],
  identifier: TopicToolIdentifier,
  meta: {
    avatar: '🗂️',
    description: 'Open and manage sub-topics: separate conversations this one starts',
    title: 'Sub-topics',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
