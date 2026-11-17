import type { ResourceTransferRequestItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { agentRouter } from '@/server/routers/lambda/agent';
import { agentGroupRouter } from '@/server/routers/lambda/agentGroup';
import { resourceTransferRequestRouter } from '@/server/routers/lambda/resourceTransferRequest';

import { BaseService } from '../common/base.service';
import type {
  CreateTransferRequest,
  TransferRequest,
  TransferRequestOutcome,
} from '../types/transfer-request.type';
import { toIso } from './workspace.service';

interface Party {
  avatar: string | null;
  fullName: string | null;
  id: string;
  username: string | null;
}

type EnrichedRow = ResourceTransferRequestItem & {
  initiator: Party | null;
  previousOwner: Party | null;
  recipient: Party | null;
  resource: {
    avatar: string | null;
    backgroundColor: string | null;
    id: string;
    title: string | null;
  } | null;
};

const toTransferRequest = (row: EnrichedRow): TransferRequest => ({
  createdAt: toIso(row.createdAt),
  expiresAt: toIso(row.expiresAt),
  id: row.id,
  initiator: row.initiator,
  initiatorId: row.initiatorId,
  previousOwner: row.previousOwner,
  previousOwnerId: row.previousOwnerId,
  recipient: row.recipient,
  recipientId: row.recipientId,
  resolvedAt: row.resolvedAt ? toIso(row.resolvedAt) : null,
  resource: row.resource,
  resourceId: row.resourceId,
  resourceType: row.resourceType,
  status: row.status,
});

/**
 * Transfer requests REST service.
 *
 * Creating one goes through the same `agent.transferAgent` /
 * `agentGroup.transferGroup` member-transfer path the web UI uses (authority
 * check, recipient validation, one pending request per resource, inbox
 * notification); answering it through `resourceTransferRequest`, which keeps
 * request ids unprobeable — a request you are not party to reads as 404.
 */
export class TransferRequestRestService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  private get ctx() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  private get requests() {
    return resourceTransferRequestRouter.createCaller(this.ctx);
  }

  /** Live requests the caller is recipient or initiator of. */
  async listMine(): Promise<TransferRequest[]> {
    const { data } = await this.requests.listMine();
    return (data as EnrichedRow[]).map(toTransferRequest);
  }

  async create(body: CreateTransferRequest): Promise<TransferRequest> {
    const result =
      body.resourceType === 'agent'
        ? await agentRouter.createCaller(this.ctx).transferAgent({
            agentId: body.resourceId,
            targetMemberId: body.recipientId,
            targetWorkspaceId: null,
          })
        : await agentGroupRouter.createCaller(this.ctx).transferGroup({
            groupId: body.resourceId,
            targetMemberId: body.recipientId,
            targetWorkspaceId: null,
          });

    const requestId =
      result && typeof result === 'object' && 'requestId' in result ? result.requestId : undefined;
    const created = requestId
      ? (await this.listMine()).find((request) => request.id === requestId)
      : undefined;
    if (!created) throw this.createBusinessError('The transfer request could not be created');
    return created;
  }

  async accept(id: string): Promise<TransferRequestOutcome> {
    await this.requests.accept({ requestId: id });
    return { id, status: 'accepted' };
  }

  async decline(id: string): Promise<TransferRequestOutcome> {
    const { data } = await this.requests.decline({ requestId: id });
    return { id, status: data?.status ?? 'declined' };
  }

  async cancel(id: string): Promise<TransferRequestOutcome> {
    const { data } = await this.requests.cancel({ requestId: id });
    return { id, status: data?.status ?? 'cancelled' };
  }
}
