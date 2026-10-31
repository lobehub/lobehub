import { TUNNEL_TOKEN_PARAM } from '@lobechat/device-gateway-client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { signTunnelAccessToken } from '@/libs/trpc/utils/internalJwt';
import { deviceGateway } from '@/server/services/deviceGateway';
import { deviceTunnels, TUNNEL_MAX_TTL_SECONDS } from '@/server/services/deviceGateway/tunnels';

import { assertDeviceOperable } from './guards';
import { deviceProcedure } from './procedures';

/** Exposing a port is at least as sensitive as reading the filesystem. */
const assertTunnelDeviceWritable = (
  ctx: Parameters<typeof assertDeviceOperable>[0],
  deviceId: string,
) => assertDeviceOperable(ctx, deviceId, 'expose a port');

/**
 * Base64 characters accepted by one `writeTerminal` call. A keystroke is a
 * handful of bytes; this only bounds what a malicious caller can push through
 * in a single request.
 */
const MAX_TERMINAL_WRITE_CHARS = 65_536;

/**
 * Relay a terminal call, surfacing the device's own reason. A device that is
 * offline — or a client without PTY support — answers with a message the user
 * needs to read; a bare 500 would make it look like a LobeHub bug.
 */
const relayTerminal = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

/** Append a freshly minted access token to a tunnel URL. */
const buildTunnelOpenUrl = async (
  url: string,
  ctx: { userId: string; workspaceId?: string },
): Promise<string> => {
  const token = await signTunnelAccessToken({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  // A dedicated param, not `?token=`: apps behind a tunnel own that name
  // (Vite's HMR socket authenticates with it).
  return `${url}?${TUNNEL_TOKEN_PARAM}=${encodeURIComponent(token)}`;
};

export const operateRouter = router({
  /** Open a link to `port` on a device. */
  createTunnel: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        port: z.number().int().min(1).max(65_535),
        ttlSeconds: z.number().int().positive().max(TUNNEL_MAX_TTL_SECONDS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTunnelDeviceWritable(ctx, input.deviceId);

      const link = await deviceTunnels.create({
        deviceId: input.deviceId,
        port: input.port,
        ttlSeconds: input.ttlSeconds,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      if (!link) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Device gateway is not configured on this deployment.',
        });
      }

      return { ...link, openUrl: await buildTunnelOpenUrl(link.url, ctx) };
    }),
  /**
   * Ports the device is listening on, so the UI can offer "5173 · vite" to
   * expose in one click. Gated like creating a tunnel: seeing which ports are
   * open is only useful to someone allowed to expose them. `null` means the
   * device couldn't answer (offline, or a client that predates detection).
   */
  listListeningPorts: deviceProcedure
    .input(z.object({ cwd: z.string().optional(), deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTunnelDeviceWritable(ctx, input.deviceId);
      const result = await deviceGateway.listListeningPorts({
        cwd: input.cwd,
        deviceId: input.deviceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),

  // ─── Remote app update ───
  //
  // Update the desktop app on a device from anywhere: check (a found update
  // downloads on its own), poll progress, then restart into it. Restarting
  // interrupts whatever the machine is running, so every step is gated like
  // exposing a port.
  getAppUpdateState: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'update the app');
      return deviceGateway.getAppUpdateState({
        deviceId: input.deviceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),
  checkAppUpdate: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'update the app');
      return deviceGateway.checkAppUpdate({
        deviceId: input.deviceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),
  installAppUpdate: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'update the app');
      return deviceGateway.installAppUpdate({
        deviceId: input.deviceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),

  // ─── Interactive terminal ───
  //
  // A terminal hands the caller a shell on the device, so it is gated exactly
  // like exposing a port. The check runs on the polling reads too, not just on
  // create — otherwise a session would outlive the permission that opened it.
  createTerminalSession: deviceProcedure
    .input(
      z.object({
        cols: z.number().int().min(1).max(1000),
        cwd: z.string().optional(),
        deviceId: z.string(),
        rows: z.number().int().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'open a terminal on');
      return relayTerminal(() =>
        deviceGateway.createTerminalSession({
          cols: input.cols,
          cwd: input.cwd,
          deviceId: input.deviceId,
          rows: input.rows,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
      );
    }),
  writeTerminal: deviceProcedure
    .input(
      z.object({
        /** Base64 keystrokes. */
        data: z.string().max(MAX_TERMINAL_WRITE_CHARS),
        deviceId: z.string(),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'use a terminal on');
      return relayTerminal(() =>
        deviceGateway.writeTerminal({
          data: input.data,
          deviceId: input.deviceId,
          id: input.id,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
      );
    }),
  readTerminal: deviceProcedure
    .input(z.object({ cursor: z.number().int().min(0), deviceId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'use a terminal on');
      return relayTerminal(() =>
        deviceGateway.readTerminal({
          cursor: input.cursor,
          deviceId: input.deviceId,
          id: input.id,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
      );
    }),
  resizeTerminal: deviceProcedure
    .input(
      z.object({
        cols: z.number().int().min(1).max(1000),
        deviceId: z.string(),
        id: z.string(),
        rows: z.number().int().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'use a terminal on');
      return relayTerminal(() =>
        deviceGateway.resizeTerminal({
          cols: input.cols,
          deviceId: input.deviceId,
          id: input.id,
          rows: input.rows,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
      );
    }),
  closeTerminal: deviceProcedure
    .input(z.object({ deviceId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'use a terminal on');
      return relayTerminal(() =>
        deviceGateway.closeTerminal({
          deviceId: input.deviceId,
          id: input.id,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
      );
    }),
  getCliUpdateState: deviceProcedure
    .input(z.object({ deviceId: z.string() }).strict())
    .query(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'maintain the CLI');
      return deviceGateway.getCliUpdateState({
        deviceId: input.deviceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),
  checkCliUpdate: deviceProcedure
    .input(z.object({ deviceId: z.string() }).strict())
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'maintain the CLI');
      return deviceGateway.checkCliUpdate({
        deviceId: input.deviceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),
  restartCli: deviceProcedure
    .input(
      z
        .object({ deviceId: z.string(), requestId: z.string().uuid(), update: z.boolean() })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDeviceOperable(ctx, input.deviceId, 'maintain the CLI');
      return deviceGateway.restartCli({
        ...input,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
    }),
  /** Live tunnel links the caller can reach, newest first. */
  listTunnels: deviceProcedure
    .input(z.object({ deviceId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) =>
      deviceTunnels.list({
        deviceId: input?.deviceId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),
  /**
   * Mint the one-shot token that opens an existing link. Tokens are minted per
   * click rather than stored with the link: the gateway swaps the token for a
   * session cookie on first use, so the URL in hand stays clean.
   */
  openTunnel: deviceProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const links = await deviceTunnels.list({ userId: ctx.userId, workspaceId: ctx.workspaceId });
      const link = links.find((candidate) => candidate.slug === input.slug);
      if (!link) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tunnel not found.' });

      return { openUrl: await buildTunnelOpenUrl(link.url, ctx), url: link.url };
    }),
  /** Revoke a link. Its session cookies stop resolving immediately. */
  revokeTunnel: deviceProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const outcome = await deviceTunnels.revoke({
        slug: input.slug,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      if (outcome === 'forbidden') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'This tunnel belongs to someone else.' });
      }
      if (outcome === 'not-found') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tunnel not found.' });
      }
      return { success: true };
    }),
});
