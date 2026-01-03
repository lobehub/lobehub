import { isDesktop } from '@lobechat/const';
import {
  GetStreamableMcpServerManifestInputSchema,
  StreamableHTTPAuthSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { type ToolCallContent } from '@/libs/mcp';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase, telemetry } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { mcpService } from '@/server/services/mcp';
import { processContentBlocks } from '@/server/services/mcp/contentProcessor';

import { scheduleToolCallReport } from './_helpers';

// Define Zod schemas for MCP Client parameters
const httpParamsSchema = z.object({
  auth: StreamableHTTPAuthSchema,
  headers: z.record(z.string()).optional(),
  name: z.string().min(1),
  type: z.literal('http'),
  url: z.string().url(),
});

const stdioParamsSchema = z.object({
  args: z.array(z.string()).optional().default([]),
  command: z.string().min(1),
  name: z.string().min(1),
  type: z.literal('stdio'),
});

// Union schema for MCPClientParams
const mcpClientParamsSchema = z.union([httpParamsSchema, stdioParamsSchema]);

const checkStdioEnvironment = (params: z.infer<typeof mcpClientParamsSchema>) => {
  if (params.type === 'stdio' && !isDesktop) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Stdio MCP type is not supported in web environment.',
    });
  }
};

// Schema for metadata that frontend needs to pass (fields that backend cannot determine)
const metaSchema = z
  .object({
    // Custom plugin info (only for custom plugins)
    customPluginInfo: z
      .object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    // Whether this is a custom plugin
    isCustomPlugin: z.boolean().optional(),
    // Session/topic ID
    sessionId: z.string().optional(),
    // Plugin manifest version
    version: z.string().optional(),
  })
  .optional();

const mcpProcedure = authedProcedure
  .use(serverDatabase)
  .use(telemetry)
  .use(async ({ ctx, next }) => {
    return next({
      ctx: {
        fileService: new FileService(ctx.serverDB, ctx.userId),
      },
    });
  });

export const mcpRouter = router({
  getStreamableMcpServerManifest: mcpProcedure
    .input(GetStreamableMcpServerManifestInputSchema)
    .query(async ({ input }) => {
      return await mcpService.getStreamableMcpServerManifest(
        input.identifier,
        input.url,
        input.metadata,
        input.auth,
        input.headers,
      );
    }),
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  // --- MCP Interaction ---
  // listTools now accepts MCPClientParams directly
  listTools: mcpProcedure
    .input(mcpClientParamsSchema) // Use the unified schema
    .query(async ({ input }) => {
      // Stdio check can be done here or rely on the service/client layer
      checkStdioEnvironment(input);

      // Pass the validated MCPClientParams to the service
      return await mcpService.listTools(input);
    }),

  // listResources now accepts MCPClientParams directly
  listResources: mcpProcedure
    .input(mcpClientParamsSchema) // Use the unified schema
    .query(async ({ input }) => {
      // Stdio check can be done here or rely on the service/client layer
      checkStdioEnvironment(input);

      // Pass the validated MCPClientParams to the service
      return await mcpService.listResources(input);
    }),

  // listPrompts now accepts MCPClientParams directly
  listPrompts: mcpProcedure
    .input(mcpClientParamsSchema) // Use the unified schema
    .query(async ({ input }) => {
      // Stdio check can be done here or rely on the service/client layer
      checkStdioEnvironment(input);

      // Pass the validated MCPClientParams to the service
      return await mcpService.listPrompts(input);
    }),

  // callTool now accepts MCPClientParams, toolName, and args
  callTool: mcpProcedure
    .input(
      z.object({
        args: z.any(), // Arguments for the tool call
        meta: metaSchema, // Optional metadata for reporting
        params: mcpClientParamsSchema, // Use the unified schema for client params
        toolName: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Stdio check can be done here or rely on the service/client layer
      checkStdioEnvironment(input.params);

      const startTime = Date.now();
      let success = true;
      let errorCode: string | undefined;
      let errorMessage: string | undefined;
      let result: Awaited<ReturnType<typeof mcpService.callTool>> | undefined;

      try {
        // Create a closure that binds fileService and userId to processContentBlocks
        const boundProcessContentBlocks = async (blocks: ToolCallContent[]) => {
          return processContentBlocks(blocks, ctx.fileService);
        };

        // Pass the validated params, toolName, args, and bound processContentBlocks to the service
        result = await mcpService.callTool({
          argsStr: input.args,
          clientParams: input.params,
          processContentBlocks: boundProcessContentBlocks,
          toolName: input.toolName,
        });

        return result;
      } catch (error) {
        success = false;
        const err = error as Error;
        errorCode = 'CALL_FAILED';
        errorMessage = err.message;
        throw error;
      } finally {
        scheduleToolCallReport({
          errorCode,
          errorMessage,
          identifier: input.params.name,
          marketAccessToken: ctx.marketAccessToken,
          mcpType: 'http',
          meta: input.meta,
          requestPayload: input.args,
          result,
          startTime,
          success,
          telemetryEnabled: ctx.telemetryEnabled,
          toolName: input.toolName,
        });
      }
    }),
});
