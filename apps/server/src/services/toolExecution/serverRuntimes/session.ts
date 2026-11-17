import { SessionIdentifier } from '@lobechat/builtin-tool-session';
import {
  SessionExecutionRuntime,
  type SessionService,
} from '@lobechat/builtin-tool-session/executionRuntime';

import {
  createSubSessionService,
  readLatestSessionTranscript,
} from '@/server/routers/lambda/subSession';
import { readSubSessionsEnabled } from '@/server/services/subSession/labGate';

import type { ServerRuntimeRegistration } from './types';

/**
 * `lobe-session`: the agent opens and manages sub-sessions of the conversation
 * it runs in, through the same service the sidebar and `lh session` use.
 */
export const sessionRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for the sub-session tool');
    }
    const db = context.serverDB;
    const userId = context.userId;
    const workspaceId = context.workspaceId ?? undefined;
    const service = createSubSessionService({ serverDB: db, userId, workspaceId });
    // The tool acts only on sub-sessions of the conversation it runs in, never
    // on any other topic the account can see.
    const ownSubSession = async (topicId: string) => {
      if (!context.topicId || !(await service.isOpenedBy(topicId, context.topicId))) {
        throw new Error(
          `${topicId} is not a sub-session of this conversation; use listSessions to see the ones it opened.`,
        );
      }
    };

    const adapter: SessionService = {
      archive: async (topicId) => {
        await ownSubSession(topicId);
        return service.retire({ action: 'archive', mode: 'self', topicId });
      },
      get: async (topicId) => {
        await ownSubSession(topicId);
        const session = await service.get(topicId);
        return {
          agentId: session.agentId,
          lastReply: session.lastReply,
          state: session.state,
          title: session.title,
          topicId,
        };
      },
      list: (openerTopicId) => service.list(openerTopicId),
      read: async (topicId, limit) => {
        await ownSubSession(topicId);
        return readLatestSessionTranscript({ db, userId, workspaceId }, { limit, topicId }) as any;
      },
      send: async (params) => {
        await ownSubSession(params.topicId);
        return service.send(params);
      },
      start: async (params) => {
        if (!(await readSubSessionsEnabled(db, userId))) {
          throw new Error('Sub-sessions need Labs → Better Coding Experience, which is off.');
        }
        return service.start(params);
      },
      stop: async (topicId) => {
        await ownSubSession(topicId);
        return service.stop(topicId);
      },
    };

    return new SessionExecutionRuntime(adapter, {
      operationId: context.operationId,
      topicId: context.topicId,
    });
  },
  identifier: SessionIdentifier,
};
