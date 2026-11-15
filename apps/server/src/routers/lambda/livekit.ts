import { conversationConfigSchema, livekitConnectionSchema } from '@lobechat/livekit-bridge';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { UserModel } from '@/database/models/user';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { LivekitService, voiceRoomPrefix } from '@/server/services/livekit';

// Connections belong to the signed-in user, including while a workspace is open.
const conversationProcedure = authedProcedure.use(serverDatabase);
const loadPersonalConfig = async (
  db: ConstructorParameters<typeof UserModel>[0],
  userId: string,
) => {
  const settings = await new UserModel(db, userId).getUserSettings();
  const vault = await KeyVaultsGateKeeper.getUserKeyVaults(settings?.keyVaults ?? null, userId);
  const connection = livekitConnectionSchema.safeParse(vault.livekit);
  if (!connection.success)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Configure your LiveKit connection in Settings → Conversation.',
    });
  const general = settings?.general as { conversation?: unknown } | null;
  return {
    connection: connection.data,
    config: conversationConfigSchema.parse(general?.conversation ?? {}),
  };
};

export const livekitRouter = router({
  checkConnection: conversationProcedure.mutation(async ({ ctx }) => {
    const { connection } = await loadPersonalConfig(ctx.serverDB, ctx.userId);
    try {
      return await new LivekitService(ctx.userId, connection).checkConnection();
    } catch {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Could not connect to LiveKit. Check your server URL and API credentials.',
      });
    }
  }),
  createSession: conversationProcedure.mutation(async ({ ctx }) => {
    const { connection, config } = await loadPersonalConfig(ctx.serverDB, ctx.userId);
    if (!config.enabled)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Enable Conversation in your personal settings.',
      });
    return new LivekitService(ctx.userId, connection).createSession(config);
  }),
  endSession: conversationProcedure
    .input(z.object({ roomName: z.string().regex(/^lobe-voice-[a-f0-9]{24}-[a-f0-9-]{36}$/) }))
    .mutation(async ({ ctx, input }) => {
      if (!input.roomName.startsWith(voiceRoomPrefix(ctx.userId)))
        throw new TRPCError({ code: 'FORBIDDEN' });
      const { connection } = await loadPersonalConfig(ctx.serverDB, ctx.userId);
      await new LivekitService(ctx.userId, connection).endSession(input.roomName);
    }),
});
