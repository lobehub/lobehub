import { CanvasApiName } from '@lobechat/builtin-tool-canvas';
import type { BuiltinServerRuntimeOutput, WorkRegistrationIntent } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  getCanvasPublishRuntimeUrl,
  isCanvasPublishEnabled,
  publishCanvasSite,
} from '@/business/server/canvasPublish';
import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { WorkModel } from '@/database/models/work';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createCanvasStorageService } from '@/server/services/canvas';
import { createCanvasAgentRuntime } from '@/server/services/canvas/agentRuntime';
import { buildCanvasPublishBundle } from '@/server/services/canvas/publish';
import { saveCanvas } from '@/server/services/canvas/save';

const canvasProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: { workModel: new WorkModel(ctx.serverDB, ctx.userId, workspaceId), workspaceId },
  });
});

export const canvasRouter = router({
  getPublishContext: canvasProcedure.query(({ ctx }) => ({
    canPublish: isCanvasPublishEnabled(),
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? null,
  })),
  getProject: canvasProcedure
    .input(z.object({ canvasId: z.string(), version: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const current = await ctx.workModel.findCanvas(input.canvasId);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND' });
      const version =
        input.version === current.version.version
          ? current.version
          : await ctx.workModel.findCanvasVersion(current.work.id, input.version);
      const canvas = version?.metadata?.canvas;
      if (!canvas) throw new TRPCError({ code: 'NOT_FOUND' });
      return createCanvasStorageService(
        ctx.serverDB,
        current.work.userId,
        ctx.workspaceId,
      ).readSnapshot(canvas.manifestKey);
    }),

  getVersion: canvasProcedure
    .input(z.object({ canvasId: z.string(), version: z.number().int().positive().optional() }))
    .query(async ({ ctx, input }) => {
      const current = await ctx.workModel.findCanvas(input.canvasId);
      if (!current) return null;

      const version =
        input.version && input.version !== current.version.version
          ? await ctx.workModel.findCanvasVersion(current.work.id, input.version)
          : current.version;
      const canvas = version?.metadata?.canvas;
      if (!version || !canvas) return null;

      return {
        canPublish: isCanvasPublishEnabled() && current.work.userId === ctx.userId,
        canvasId: input.canvasId,
        createdAt: version.createdAt,
        description: version.description ?? current.work.description,
        latestVersion: current.version.version,
        metadata: canvas,
        publishedUrl: current.work.url,
        publishedVersion: current.work.metadata?.canvasPublish?.publishedVersion ?? null,
        title: version.title ?? current.work.title,
        version: version.version,
        workId: current.work.id,
      };
    }),

  publish: canvasProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(
      z.object({
        canvasId: z.string(),
        deploymentId: z.string().optional(),
        requestedSlug: z.string().trim().min(1).max(255).optional(),
        version: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isCanvasPublishEnabled()) {
        throw new TRPCError({
          code: 'NOT_IMPLEMENTED',
          message: 'Canvas publishing is unavailable',
        });
      }

      const current = await ctx.workModel.findCanvas(input.canvasId);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND' });
      if (current.work.userId !== ctx.userId) throw new TRPCError({ code: 'FORBIDDEN' });
      const version =
        input.version && input.version !== current.version.version
          ? await ctx.workModel.findCanvasVersion(current.work.id, input.version)
          : current.version;
      const canvas = version?.metadata?.canvas;
      if (!version || !canvas) throw new TRPCError({ code: 'NOT_FOUND' });

      const runtimeUrl = await getCanvasPublishRuntimeUrl(canvas.runtimeMajor).catch((cause) => {
        throw new TRPCError({
          cause,
          code: 'PRECONDITION_FAILED',
          message: 'The publication host has no compatible Canvas runtime',
        });
      });
      if (!runtimeUrl) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The publication host has no compatible Canvas runtime',
        });
      }

      const storage = createCanvasStorageService(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const bundle = await buildCanvasPublishBundle(
        storage,
        await storage.readManifest(canvas.manifestKey),
        runtimeUrl,
      );
      const site = await publishCanvasSite({
        bundle,
        canvasId: input.canvasId,
        db: ctx.serverDB,
        deploymentId: input.deploymentId ?? current.work.metadata?.canvasPublish?.deploymentId,
        requestedSlug: input.requestedSlug,
        title: version.title ?? current.work.title ?? input.canvasId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      if (!input.deploymentId) {
        await ctx.workModel.recordCanvasPublish(input.canvasId, {
          deploymentId: site.deploymentId,
          publishedVersion: version.version,
          url: site.url,
        });
      }

      return {
        deploymentId: site.deploymentId,
        publishedVersion: version.version,
        ...(site.subdomainLabel ? { subdomainLabel: site.subdomainLabel } : {}),
        url: site.url,
      };
    }),

  runAgentTool: canvasProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(
      z.object({
        apiName: z.enum(Object.values(CanvasApiName) as [string, ...string[]]),
        args: z.record(z.string(), z.unknown()),
        context: z
          .object({
            agentId: z.string().nullish(),
            messageId: z.string().nullish(),
            threadId: z.string().nullish(),
            topicId: z.string().nullish(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const context = input.context ?? {};
      const runtime = createCanvasAgentRuntime(ctx.serverDB, {
        agentId: context.agentId,
        threadId: context.threadId,
        topicId: context.topicId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      let intent: WorkRegistrationIntent | undefined;
      const onWorkRegistration = (next: WorkRegistrationIntent) => {
        intent = next;
      };
      const args = input.args as any;
      let output: BuiltinServerRuntimeOutput;
      switch (input.apiName) {
        case CanvasApiName.createCanvas: {
          output = await runtime.createCanvas(args, { onWorkRegistration });
          break;
        }
        case CanvasApiName.updateCanvas: {
          output = await runtime.updateCanvas(args, { onWorkRegistration });
          break;
        }
        case CanvasApiName.readCanvas: {
          output = await runtime.readCanvas(args);
          break;
        }
        case CanvasApiName.listCanvases: {
          output = await runtime.listCanvases();
          break;
        }
        default: {
          output = await runtime.readCanvasGuide();
        }
      }

      return { intent, output };
    }),

  listVersions: canvasProcedure
    .input(z.object({ canvasId: z.string() }))
    .query(async ({ ctx, input }) => {
      const current = await ctx.workModel.findCanvas(input.canvasId);
      if (!current) return [];

      const versions = await ctx.workModel.listVersions(current.work.id);
      return versions.map((item) => ({
        createdAt: item.createdAt,
        description: item.description,
        title: item.title,
        version: item.version,
      }));
    }),

  save: canvasProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(
      z.object({
        canvasId: z.string().max(128).optional(),
        expectedVersion: z.number().int().nonnegative(),
        html: z.string().max(512 * 1024),
        requestId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(({ ctx, input }) =>
      saveCanvas(input, {
        storage: createCanvasStorageService(ctx.serverDB, ctx.userId, ctx.workspaceId),
        userId: ctx.userId,
        workModel: ctx.workModel,
        workspaceId: ctx.workspaceId,
      }),
    ),
});
