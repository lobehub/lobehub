import { RequestTrigger } from '@lobechat/types';

import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { ScmChangeRequestModel, ScmIdentityModel } from '@/database/models/scm';
import type { LobeChatDatabase } from '@/database/type';

export interface RunRequesterInput {
  botIsOwner?: boolean;
  botSender?: { id: string; platform: string };
  ownerUserId: string;
  scmChangeRequestId?: string;
  shareVisitorUserId?: string;
  trigger?: string;
}

const CHANNEL_TRIGGER = 'channel';

const OWNER_TRIGGERS = new Set<string>([
  RequestTrigger.Chat,
  RequestTrigger.Cli,
  RequestTrigger.Cron,
  RequestTrigger.Goal,
  RequestTrigger.Notify,
  RequestTrigger.Scheduled,
  RequestTrigger.Task,
  RequestTrigger.TaskCallback,
  CHANNEL_TRIGGER,
]);

const resolveBotSender = async (
  db: LobeChatDatabase,
  input: RunRequesterInput,
): Promise<string | undefined> => {
  if (input.botIsOwner) return input.ownerUserId;
  if (!input.botSender) return;

  const link = await MessengerAccountLinkModel.findByPlatformUser(
    db,
    input.botSender.platform,
    input.botSender.id,
  );
  return link?.userId;
};

const resolveScmAuthor = async (
  db: LobeChatDatabase,
  changeRequestId?: string,
): Promise<string | undefined> => {
  if (!changeRequestId) return;

  const changeRequest = await ScmChangeRequestModel.findById(db, changeRequestId);
  if (!changeRequest?.authorExternalId) return;

  const identity = await ScmIdentityModel.findByExternalUser(
    db,
    changeRequest.provider,
    changeRequest.authorExternalId,
  );
  return identity?.userId;
};

export const resolveRunRequester = async (
  db: LobeChatDatabase,
  input: RunRequesterInput,
): Promise<string | undefined> => {
  if (input.shareVisitorUserId) return input.shareVisitorUserId;

  switch (input.trigger) {
    case undefined: {
      return input.ownerUserId;
    }
    case RequestTrigger.Bot: {
      return resolveBotSender(db, input);
    }
    case RequestTrigger.Scm: {
      return resolveScmAuthor(db, input.scmChangeRequestId);
    }
    default: {
      return OWNER_TRIGGERS.has(input.trigger) ? input.ownerUserId : undefined;
    }
  }
};
