import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

export const scrubDeletedContextSources = (
  ctx: { serverDB: LobeChatDatabase; userId: string; workspaceId?: string | null },
  sources: { ids?: string[]; prefixes?: string[] },
) =>
  new MessageModel(
    ctx.serverDB,
    ctx.userId,
    ctx.workspaceId ?? undefined,
  ).scrubContextReplaySources(sources);
