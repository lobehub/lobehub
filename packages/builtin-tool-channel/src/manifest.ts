import type { BuiltinToolManifest } from '@lobechat/types';
import { CHANNEL_ASK_LIMITS } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ChannelApiName, ChannelIdentifier } from './types';

export const ChannelManifest: BuiltinToolManifest = {
  identifier: ChannelIdentifier,
  type: 'builtin',
  systemRole: systemPrompt,
  meta: {
    avatar: '#',
    title: 'Channel',
    description:
      'Read the current shared conversation, message Agents in your other Channels, and message people for your requester.',
  },
  api: [
    {
      name: ChannelApiName.askUser,
      description:
        "Ask your requester to choose, as a card of options posted with your final answer. Use it when you need their decision to go on and the choices can be listed, e.g. which area to start with. The run does not wait: after calling it, end your turn with a short lead-in to the question (do not repeat the options, the card shows them). Their pick arrives later as a new request replying to your question, and you continue from there. Every card also offers 'Other' for their own words. Once per reply; only for a person's own request.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: CHANNEL_ASK_LIMITS.maxQuestions,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['question', 'options'],
              properties: {
                question: {
                  type: 'string',
                  maxLength: CHANNEL_ASK_LIMITS.questionLength,
                  description: "The question, in your requester's language.",
                },
                header: {
                  type: 'string',
                  maxLength: CHANNEL_ASK_LIMITS.headerLength,
                  description: 'Optional short label above the question.',
                },
                multiSelect: {
                  type: 'boolean',
                  description: 'Allow picking several options. Default false.',
                },
                options: {
                  type: 'array',
                  minItems: CHANNEL_ASK_LIMITS.minOptions,
                  maxItems: CHANNEL_ASK_LIMITS.maxOptions,
                  description: "Distinct choices; do not add an 'Other' option, the card has one.",
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['label'],
                    properties: {
                      label: { type: 'string', maxLength: CHANNEL_ASK_LIMITS.labelLength },
                      description: {
                        type: 'string',
                        maxLength: CHANNEL_ASK_LIMITS.descriptionLength,
                        description: 'Optional one-line explanation.',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      name: ChannelApiName.readMessages,
      description:
        'Read recent public messages in the current Channel or thread, in chronological order. Includes the parent channel prefix up to the thread root. Default 10, maximum 20 messages, with 2000-character excerpts. Use nextBeforeSequence to page backwards; readMessage retrieves full text and attachments. Your own conversation is read up to the request cutoff; pass threadId (from listThreads) to read another Thread of this Channel live, up to its latest message.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          beforeSequence: {
            type: 'integer',
            minimum: 1,
            description: 'Exclusive cursor from nextBeforeSequence. Omit for the most recent page.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Number of messages; default 10.',
          },
          threadId: {
            type: 'string',
            description:
              'Another Thread of this Channel, from listThreads. Omit for your own conversation.',
          },
        },
      },
    },
    {
      name: ChannelApiName.readMessage,
      description:
        'Read up to 12000 characters of one public message, with author and attachment references. Use a message ID returned by readMessages (or the current request), with the same threadId if readMessages read another Thread. Follow nextOffset for the remaining text; null means complete.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['messageId'],
        properties: {
          messageId: { type: 'string', description: 'Message ID in the current conversation.' },
          offset: {
            type: 'integer',
            minimum: 0,
            description: 'Character offset from nextOffset. Default 0.',
          },
          threadId: {
            type: 'string',
            description:
              'The threadId you passed to readMessages when it returned this message from another Thread.',
          },
        },
      },
    },
    {
      name: ChannelApiName.listChannels,
      description:
        "List the Channels your requester belongs to, newest first, with each Channel's Agent members (agentId, name, description). Use it to find where to reach another Agent before sendMessage. The Channel you are answering in is marked current. Filter with agentId (Channels that Agent is in) or query (Channel title or Agent name). Default 10, maximum 20.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agentId: {
            type: 'string',
            description: 'Only Channels where this Agent is a member.',
          },
          query: {
            type: 'string',
            description: 'Case-insensitive match on the Channel title or an Agent member name.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Number of Channels; default 10.',
          },
        },
      },
    },
    {
      name: ChannelApiName.requestConnector,
      description:
        'Ask the person to connect a connector (an app or MCP server) you need, as a card in this conversation with a one-click Connect button; they authorize in place and need no URL or key from you. Use it whenever the person asks you to connect something or a task needs a connector that is not connected yet, instead of pasting an authorization link. Pass a catalog identifier (e.g. github, linear, notion, sentry, stripe); for an MCP server outside the catalog also pass its https url. The card is posted right away; finish your answer by saying it is there, and use the connector from your next turn once connected.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['identifier'],
        properties: {
          auth: {
            type: 'string',
            enum: ['oauth', 'none'],
            description: 'Only with url: how the server authorizes. Default oauth.',
          },
          identifier: {
            type: 'string',
            description: 'Catalog identifier, or a short id (letters, digits, _ and -) for a url.',
          },
          name: { type: 'string', description: 'Only with url: display name of the server.' },
          reason: {
            type: 'string',
            description: 'One short sentence on what you will do with it, shown on the card.',
          },
          url: {
            type: 'string',
            description: 'The https MCP endpoint of a server outside the catalog.',
          },
        },
      },
    },
    {
      name: ChannelApiName.sendMessage,
      description:
        "Ask or tell another Agent something. Address one Agent by agentIds: it is asked in the conversation between you two, never in the person's conversation or a group; its answer wakes you there, and what you then write is posted back where you asked. To address several Agents together, also give channelId, a group they are all in: the message appears as your requester's, marked as relayed by you, they answer in that group, and the reply is brought back to you here as a new request. Find agentIds with listChannels. The person sees a notice of the message where you are answering, so do not paste a link or open a Thread for it: say briefly what you asked and that the answer will follow.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['agentIds', 'content'],
        properties: {
          agentIds: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 5,
            description: 'Agents to address. One Agent is asked directly; several need channelId.',
          },
          channelId: {
            type: 'string',
            description:
              'A group Channel from listChannels that every addressed Agent is in. Only for several Agents.',
          },
          content: {
            type: 'string',
            description:
              'The message, self-contained: the addressed Agent does not see this conversation.',
          },
        },
      },
    },
    {
      name: ChannelApiName.listPeople,
      description:
        'List the people your requester can message one-on-one (userId, name, username): their contacts, or in a workspace its members and the external contacts paired with them. Use it to find who messagePerson can reach. Filter with query (part of the name or @handle). Default 10, maximum 20.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            description: "Case-insensitive part of the person's name or @handle.",
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Number of people; default 10.',
          },
        },
      },
    },
    {
      name: ChannelApiName.messagePerson,
      description:
        "Message one person for your requester, e.g. when asked to let someone know once you are done. It is posted in your requester's one-on-one conversation with that person, as your requester's message marked as sent by you, and the person is notified. No Agent answers there and nothing comes back to you. Get userId from listPeople; if several people match the name, ask your requester instead of guessing. Not for your requester: your final answer reaches them.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['userId', 'content'],
        properties: {
          userId: { type: 'string', description: 'The person, from listPeople.' },
          content: {
            type: 'string',
            description:
              'The message, self-contained and written for that person: they do not see this conversation.',
          },
        },
      },
    },
    {
      name: ChannelApiName.listThreads,
      description:
        "List the Threads of the current Channel, newest first: each Thread's root (what it is about), its latest message, and your latest reply there with its status (queued, running, completed, failed, cancelled, silent), when it started, steps taken and, for a running reply your requester asked for, its latest steps. Use it to know what you are working on in parallel before reporting progress, stopping or steering. Default 10, maximum 20; pass before from nextBefore to read older Threads when hasMore is true.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          activeOnly: {
            type: 'boolean',
            description: 'Only Threads where you have a queued or running reply.',
          },
          before: {
            type: 'string',
            description:
              'Exclusive cursor: the last threadId of the previous page (nextBefore). Omit for the newest page.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Number of Threads; default 10.',
          },
        },
      },
    },
    {
      name: ChannelApiName.createThread,
      description:
        "Open a new Thread in the current Channel for one piece of work and start it: the title is posted on the main timeline as the Thread root, and the request is posted in the Thread as your requester's, @mentioning the Agent (you by default), which then answers there in parallel with you. Use it to split work into parallel Threads. Not available when an Agent posted the request you are answering.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'content'],
        properties: {
          title: {
            type: 'string',
            description:
              "Short title of the work, in your requester's language (max 200 characters).",
          },
          content: {
            type: 'string',
            description:
              'The request, self-contained: the run in the Thread sees the Thread and the main timeline up to its root, not your conversation.',
          },
          agentId: {
            type: 'string',
            description: 'An Agent member of this Channel to answer; defaults to you.',
          },
        },
      },
    },
    {
      name: ChannelApiName.stopThread,
      description:
        "Stop the replies running or queued in another Thread of the current Channel (your requester's own requests there; every reply for an admin). The Thread and its history stay. Use it when the person says a piece of work is no longer needed.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['threadId'],
        properties: {
          threadId: { type: 'string', description: 'Thread id from listThreads.' },
          reason: { type: 'string', description: 'Optional. One short sentence on why.' },
        },
      },
    },
    {
      name: ChannelApiName.steerThread,
      description:
        'Send a correction to your reply in another Thread of the current Channel. If it is running, the reply takes the correction in at its next step and keeps going (delivery `steered`), and the correction is posted in the Thread for the record. If nothing of yours runs there, it is posted in the Thread as a new request for you (delivery `queued`). Prefer this over stopping and starting again when the work only needs to change course.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['threadId', 'content'],
        properties: {
          threadId: { type: 'string', description: 'Thread id from listThreads.' },
          content: {
            type: 'string',
            description: 'The correction, self-contained, as an instruction to the running reply.',
          },
        },
      },
    },
    {
      name: ChannelApiName.watchThreads,
      description:
        "Report on Threads every intervalMinutes: each report is posted on the main timeline as your requester's request to you, so you answer it with an update (use listThreads / readMessages there). It stops after maxReports, when stopped with unwatchThreads, or once none of your replies in those Threads runs, with a last report asking for a summary. Use it when the person asks for regular progress updates. Not available when an Agent posted the request you are answering.",
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['threadIds', 'intervalMinutes'],
        properties: {
          threadIds: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 10,
            description: 'Thread ids from listThreads.',
          },
          intervalMinutes: {
            type: 'integer',
            minimum: 1,
            maximum: 120,
            description: 'Minutes between reports.',
          },
          maxReports: {
            type: 'integer',
            minimum: 1,
            maximum: 48,
            description: 'Most reports to post; default 12.',
          },
          prompt: {
            type: 'string',
            description:
              "What each report should cover, in your requester's language, e.g. what the person asked to be told.",
          },
        },
      },
    },
    {
      name: ChannelApiName.unwatchThreads,
      description: 'Stop the scheduled reports of a watch started with watchThreads.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['watchId'],
        properties: {
          watchId: { type: 'string', description: 'The watchId watchThreads returned.' },
        },
      },
    },
  ],
};
