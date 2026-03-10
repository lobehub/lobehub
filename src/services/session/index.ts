import { type PartialDeep } from 'type-fest';

import { lambdaClient } from '@/libs/trpc/client';
import { type LobeAgentChatConfig, type LobeAgentConfig } from '@/types/agent';
import { type MetaData } from '@/types/meta';
import {
  type ChatSessionList,
  type LobeAgentSession,
  type LobeSessions,
  type LobeSessionType,
  type SessionGroupItem,
  type SessionRankItem,
  type UpdateSessionParams,
} from '@/types/session';

export class SessionService {
  hasSessions = async (): Promise<boolean> => {
    const result = await this.countSessions();
    return result === 0;
  };

  createSession = async (
    type: LobeSessionType,
    data: Partial<LobeAgentSession>,
  ): Promise<string> => {
    const { config, group, meta, ...session } = data;
    return lambdaClient.session.createSession.mutate({
      config: { ...config, ...meta } as any,
      session: { ...session, groupId: group },
      type,
    });
  };

  cloneSession = (id: string, newTitle: string): Promise<string | undefined> => {
    return lambdaClient.session.cloneSession.mutate({ id, newTitle });
  };

  getGroupedSessions = (): Promise<ChatSessionList> => {
    return lambdaClient.session.getGroupedSessions.query();
  };

  countSessions = async (params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    return lambdaClient.session.countSessions.query(params);
  };

  rankSessions = async (limit?: number): Promise<SessionRankItem[]> => {
    return lambdaClient.session.rankSessions.query(limit);
  };

  updateSession = (id: string, data: Partial<UpdateSessionParams>) => {
    const { group, pinned, meta, updatedAt } = data;
    return lambdaClient.session.updateSession.mutate({
      id,
      value: { groupId: group === 'default' ? null : group, pinned, ...meta, updatedAt },
    });
  };

  // TODO: Need to be fixed
  getSessionConfig = async (id: string): Promise<LobeAgentConfig> => {
    // @ts-ignore
    return lambdaClient.agent.getAgentConfig.query({ sessionId: id });
  };

  updateSessionConfig = (
    id: string,
    config: PartialDeep<LobeAgentConfig>,
    signal?: AbortSignal,
  ) => {
    return lambdaClient.session.updateSessionConfig.mutate(
      { id, value: config },
      {
        context: { showNotification: false },
        signal,
      },
    );
  };

  updateSessionMeta = (id: string, meta: Partial<MetaData>, signal?: AbortSignal) => {
    return lambdaClient.session.updateSessionConfig.mutate({ id, value: meta }, { signal });
  };

  updateSessionChatConfig = (
    id: string,
    value: Partial<LobeAgentChatConfig>,
    signal?: AbortSignal,
  ) => {
    return lambdaClient.session.updateSessionChatConfig.mutate({ id, value }, { signal });
  };

  searchSessions = (keywords: string): Promise<LobeSessions> => {
    return lambdaClient.session.searchSessions.query({ keywords });
  };

  removeSession = (id: string) => {
    return lambdaClient.session.removeSession.mutate({ id });
  };

  removeAllSessions = () => {
    return lambdaClient.session.removeAllSessions.mutate();
  };

  // ************************************** //
  // ***********  SessionGroup  *********** //
  // ************************************** //

  createSessionGroup = (name: string, sort?: number): Promise<string> => {
    return lambdaClient.sessionGroup.createSessionGroup.mutate({ name, sort });
  };

  removeSessionGroup = (id: string, removeChildren?: boolean) => {
    return lambdaClient.sessionGroup.removeSessionGroup.mutate({ id, removeChildren });
  };

  removeSessionGroups = () => {
    return lambdaClient.sessionGroup.removeAllSessionGroups.mutate();
  };

  updateSessionGroup = (id: string, value: Partial<SessionGroupItem>) => {
    return lambdaClient.sessionGroup.updateSessionGroup.mutate({ id, value });
  };

  updateSessionGroupOrder = (sortMap: { id: string; sort: number }[]) => {
    return lambdaClient.sessionGroup.updateSessionGroupOrder.mutate({ sortMap });
  };
}

export const sessionService = new SessionService();
