import { getOfficialMcpServerById, resolveConnectorCatalogItem } from '@lobechat/const';
import type {
  ChannelAskedUser,
  ChannelAskUserParams,
  ChannelConnectorRequest,
  ChannelConnectorRequestResult,
  ChannelReadMessageParams,
  ChannelReadMessagesParams,
  ChannelRequestConnectorParams,
} from '@lobechat/types';
import { normalizeChannelAskInput } from '@lobechat/types';
import pMap from 'p-map';

import { composioEnv } from '@/config/composio';
import {
  channelAttachments,
  ChannelError,
  ChannelHistoryRepository,
} from '@/database/repositories/channel';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { FileService } from '@/server/services/file';

import { assertChannelEnabled } from './featureGate';
import { notifyChannel } from './notify';

const IDENTIFIER = /^[\w-]{1,64}$/;

/**
 * What the card shows for a requested connector: the catalog entry that owns the identifier, the
 * way the Market renders it, or the given HTTPS server when no catalog has it.
 */
export const resolveConnectorRequest = (
  params: ChannelRequestConnectorParams,
): Omit<ChannelConnectorRequest, 'agentId'> => {
  const identifier = params.identifier.trim();
  if (!IDENTIFIER.test(identifier))
    throw new ChannelError(
      'BAD_REQUEST',
      'A connector identifier uses only letters, digits, "_" and "-"',
    );
  const reason = params.reason?.trim().slice(0, 280) || null;

  const catalog = resolveConnectorCatalogItem(identifier, {
    composio: !!composioEnv.COMPOSIO_API_KEY,
    lobehub: !!(appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID),
  });
  if (catalog) {
    const name = catalog.type === 'lobehub' ? catalog.provider.label : catalog.serverType.label;
    return { auth: null, identifier, name, reason, source: catalog.type, url: null };
  }
  const official = getOfficialMcpServerById(identifier);
  if (official)
    return {
      auth: null,
      identifier,
      name: official.label,
      reason,
      source: 'official',
      url: null,
    };

  if (!params.url)
    throw new ChannelError(
      'NOT_FOUND',
      `"${identifier}" is not in the connector catalog; pass the MCP server url to ask for it`,
    );
  let url: URL;
  try {
    url = new URL(params.url);
  } catch {
    throw new ChannelError('BAD_REQUEST', 'The connector url is not a valid URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new ChannelError('BAD_REQUEST', 'The connector url must be https, without credentials');
  return {
    auth: params.auth === 'none' ? 'none' : 'oauth',
    identifier,
    name: params.name?.trim().slice(0, 64) || identifier,
    reason,
    source: 'custom',
    url: url.toString(),
  };
};

/** Both the builtin tool and operation-authenticated CLI use this exact read boundary. */
export class ChannelHistoryService {
  private readonly repository: ChannelHistoryRepository;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly operationId: string,
    private readonly workspaceId?: string,
  ) {
    this.repository = new ChannelHistoryRepository(db, userId, workspaceId);
  }

  /** Holds the run's questions; publishing its reply posts them as an `ask` card. */
  askUser = async (params: ChannelAskUserParams): Promise<ChannelAskedUser> => {
    await assertChannelEnabled(this.userId);
    let input;
    try {
      input = normalizeChannelAskInput(params);
    } catch (error) {
      throw new ChannelError('BAD_REQUEST', (error as Error).message);
    }
    await this.repository.ask(this.operationId, input);
    return { questions: input.questions.length, status: 'posts_with_reply' };
  };

  readMessages = async (params: ChannelReadMessagesParams) => {
    await assertChannelEnabled(this.userId);
    return this.repository.readMessages(this.operationId, params);
  };

  readMessage = async (params: ChannelReadMessageParams) => {
    await assertChannelEnabled(this.userId);
    const result = await this.repository.readMessage(this.operationId, params);
    const ids = result.message.fileIds ?? [];
    const shared = await channelAttachments(this.db, ids);
    const fileService = new FileService(this.db, this.userId, this.workspaceId);
    return {
      ...result,
      attachments: await pMap(
        shared,
        async (file) => ({ ...file, url: await fileService.getFullFileUrl(file.url, 300) }),
        { concurrency: 10 },
      ),
    };
  };

  /**
   * Posts a card in the run's conversation asking its requester to connect a connector; the
   * person connects from the card. `requestKey` (the tool call) keeps a retry from posting twice.
   */
  requestConnector = async (
    params: ChannelRequestConnectorParams,
    requestKey: string,
  ): Promise<ChannelConnectorRequestResult> => {
    await assertChannelEnabled(this.userId);
    const request = resolveConnectorRequest(params);
    const message = await this.repository.postConnectorRequest(
      this.operationId,
      request,
      `connector:${this.operationId}:${requestKey}`,
    );
    await notifyChannel(this.db, message.channelId);
    return { messageId: message.id, name: request.name, source: request.source };
  };
}
