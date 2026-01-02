import { CURRENT_VERSION, isDesktop } from '@lobechat/const';
import {
  GetStreamableMcpServerManifestInputSchema,
  StreamableHTTPAuthSchema,
} from '@lobechat/types';
import { type CallReportRequest } from '@lobehub/market-types';
import { TRPCError } from '@trpc/server';
import { after } from 'next/server';
import { z } from 'zod';

import { type ToolCallContent } from '@/libs/mcp';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase, telemetry } from '@/libs/trpc/lambda/middleware';
import { DiscoverService } from '@/server/services/discover';
import { FileService } from '@/server/services/file';
import { mcpService } from '@/server/services/mcp';
import { processContentBlocks } from '@/server/services/mcp/contentProcessor';

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

// Schema for report metadata that frontend needs to pass
// (fields that backend cannot determine)
const reportMetaSchema = z
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

/**
 * Calculate byte size of object
 */
const calculateObjectSizeBytes = (obj: unknown): number => {
  try {
    const jsonString = JSON.stringify(obj);
    return new TextEncoder().encode(jsonString).length;
  } catch {
    return 0;
  }
};

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
        params: mcpClientParamsSchema, // Use the unified schema for client params
        reportMeta: reportMetaSchema, // Optional metadata for reporting
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
        console.log(
          'telemetryEnabled:',
          ctx.telemetryEnabled,
          'marketAccessToken:',
          ctx.marketAccessToken,
        );
        // Only report when telemetry is enabled and marketAccessToken exists
        if (ctx.telemetryEnabled && ctx.marketAccessToken) {
          // Use Next.js after() to report after response is sent
          after(async () => {
            try {
              const callDurationMs = Date.now() - startTime;
              const requestSizeBytes = calculateObjectSizeBytes(input.args);
              const responseSizeBytes = success && result ? calculateObjectSizeBytes(result) : 0;

              const reportData: CallReportRequest = {
                callDurationMs,
                customPluginInfo: input.reportMeta?.customPluginInfo,
                errorCode,
                errorMessage,
                identifier: input.params.name,
                isCustomPlugin: input.reportMeta?.isCustomPlugin,
                metadata: {
                  appVersion: CURRENT_VERSION,
                  mcpType: 'http',
                },
                methodName: input.toolName,
                methodType: 'tool',
                requestSizeBytes,
                responseSizeBytes,
                sessionId: input.reportMeta?.sessionId,
                success,
                version: input.reportMeta?.version || 'unknown',
              };

              const discoverService = new DiscoverService({ accessToken: ctx.marketAccessToken });
              console.log('sendData:', reportData);

              await discoverService.reportCall(reportData);
            } catch (reportError) {
              console.error('Failed to report MCP tool call: %O', reportError);
            }
          });
        }
      }
    }),
});
