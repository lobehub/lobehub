import { type CodeInterpreterToolName, MarketSDK } from '@lobehub/market-sdk';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { sha256 } from 'js-sha256';
import { z } from 'zod';

import { type ToolCallContent } from '@/libs/mcp';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase, telemetry } from '@/libs/trpc/lambda/middleware';
import { generateTrustedClientToken, isTrustedClientEnabled } from '@/libs/trusted-client';
import { FileS3 } from '@/server/modules/S3';
import { DiscoverService } from '@/server/services/discover';
import { FileService } from '@/server/services/file';
import {
  contentBlocksToString,
  processContentBlocks,
} from '@/server/services/mcp/contentProcessor';

import { scheduleToolCallReport } from './_helpers';

const log = debug('lobe-server:tools:market');

// ============================== Common Procedure ==============================
const marketToolProcedure = authedProcedure
  .use(serverDatabase)
  .use(telemetry)
  .use(marketUserInfo)
  .use(async ({ ctx, next }) => {
    const { UserModel } = await import('@/database/models/user');
    const userModel = new UserModel(ctx.serverDB, ctx.userId);

    return next({
      ctx: {
        discoverService: new DiscoverService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
        fileService: new FileService(ctx.serverDB, ctx.userId),
        userModel,
      },
    });
  });

// ============================== Schema Definitions ==============================

// Schema for metadata that frontend needs to pass (for cloud MCP reporting)
const metaSchema = z
  .object({
    customPluginInfo: z
      .object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    isCustomPlugin: z.boolean().optional(),
    sessionId: z.string().optional(),
    version: z.string().optional(),
  })
  .optional();

// Schema for code interpreter tool call request
const callCodeInterpreterToolSchema = z.object({
  marketAccessToken: z.string().optional(),
  params: z.record(z.any()),
  toolName: z.string(),
  topicId: z.string(),
  userId: z.string(),
});

// Schema for export and upload file (combined operation)
const exportAndUploadFileSchema = z.object({
  filename: z.string(),
  path: z.string(),
  topicId: z.string(),
});

// Schema for cloud MCP endpoint call
const callCloudMcpEndpointSchema = z.object({
  apiParams: z.record(z.any()),
  identifier: z.string(),
  meta: metaSchema,
  toolName: z.string(),
});

// ============================== Type Exports ==============================
export type CallCodeInterpreterToolInput = z.infer<typeof callCodeInterpreterToolSchema>;
export type ExportAndUploadFileInput = z.infer<typeof exportAndUploadFileSchema>;

export interface CallToolResult {
  error?: {
    message: string;
    name?: string;
  };
  result: any;
  sessionExpiredAndRecreated?: boolean;
  success: boolean;
}

export interface ExportAndUploadFileResult {
  error?: {
    message: string;
  };
  fileId?: string;
  filename: string;
  mimeType?: string;
  size?: number;
  success: boolean;
  url?: string;
}

// ============================== Router ==============================
export const marketRouter = router({
  // ============================== Cloud MCP Gateway ==============================
  callCloudMcpEndpoint: marketToolProcedure
    .input(callCloudMcpEndpointSchema)
    .mutation(async ({ input, ctx }) => {
      log('callCloudMcpEndpoint input: %O', input);

      const startTime = Date.now();
      let success = true;
      let errorCode: string | undefined;
      let errorMessage: string | undefined;
      let result: { content: string; state: any; success: boolean } | undefined;

      try {
        // Check if trusted client is enabled - if so, we don't need user's accessToken
        const trustedClientEnabled = isTrustedClientEnabled();

        let userAccessToken: string | undefined;

        if (!trustedClientEnabled) {
          // Query user_settings to get market.accessToken only if trusted client is not enabled
          const userState = await ctx.userModel.getUserState(async () => ({}));
          userAccessToken = userState.settings?.market?.accessToken;

          log('callCloudMcpEndpoint: userAccessToken exists=%s', !!userAccessToken);

          if (!userAccessToken) {
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              message: 'User access token not found. Please sign in to Market first.',
            });
          }
        } else {
          log('callCloudMcpEndpoint: using trusted client authentication');
        }

        const cloudResult = await ctx.discoverService.callCloudMcpEndpoint({
          apiParams: input.apiParams,
          identifier: input.identifier,
          toolName: input.toolName,
          userAccessToken,
        });
        const cloudResultContent = (cloudResult?.content ?? []) as ToolCallContent[];

        // Format the cloud result to MCPToolCallResult format
        // Process content blocks (upload images, etc.)
        const newContent =
          cloudResult?.isError || !ctx.fileService
            ? cloudResultContent
            : await processContentBlocks(cloudResultContent, ctx.fileService);

        // Convert content blocks to string
        const content = contentBlocksToString(newContent);
        const state = { ...cloudResult, content: newContent };

        result = { content, state, success: true };
        return result;
      } catch (error) {
        success = false;
        const err = error as Error;
        errorCode = 'CALL_FAILED';
        errorMessage = err.message;

        log('Error calling cloud MCP endpoint: %O', error);

        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to call cloud MCP endpoint',
        });
      } finally {
        scheduleToolCallReport({
          errorCode,
          errorMessage,
          identifier: input.identifier,
          marketAccessToken: ctx.marketAccessToken,
          mcpType: 'cloud',
          meta: input.meta,
          requestPayload: input.apiParams,
          result,
          startTime,
          success,
          telemetryEnabled: ctx.telemetryEnabled,
          toolName: input.toolName,
        });
      }
    }),

  // ============================== Code Interpreter ==============================
  callCodeInterpreterTool: marketToolProcedure
    .input(callCodeInterpreterToolSchema)
    .mutation(async ({ input, ctx }) => {
      const { toolName, params, userId, topicId, marketAccessToken } = input;

      log('Calling cloud code interpreter tool: %s with params: %O', toolName, {
        params,
        topicId,
        userId,
      });
      log('Market access token available: %s', marketAccessToken ? 'yes' : 'no');

      // Generate trusted client token if user info is available
      const trustedClientToken = ctx.marketUserInfo
        ? generateTrustedClientToken(ctx.marketUserInfo)
        : undefined;

      try {
        // Initialize MarketSDK with market access token and trusted client token
        const market = new MarketSDK({
          accessToken: marketAccessToken,
          baseURL: process.env.NEXT_PUBLIC_MARKET_BASE_URL,
          trustedClientToken,
        });

        // Call market-sdk's runBuildInTool
        const response = await market.plugins.runBuildInTool(
          toolName as CodeInterpreterToolName,
          params as any,
          { topicId, userId },
        );

        log('Cloud code interpreter tool %s response: %O', toolName, response);

        if (!response.success) {
          return {
            error: {
              message: response.error?.message || 'Unknown error',
              name: response.error?.code,
            },
            result: null,
            sessionExpiredAndRecreated: false,
            success: false,
          } as CallToolResult;
        }

        return {
          result: response.data?.result,
          sessionExpiredAndRecreated: response.data?.sessionExpiredAndRecreated || false,
          success: true,
        } as CallToolResult;
      } catch (error) {
        log('Error calling cloud code interpreter tool %s: %O', toolName, error);

        return {
          error: {
            message: (error as Error).message,
            name: (error as Error).name,
          },
          result: null,
          sessionExpiredAndRecreated: false,
          success: false,
        } as CallToolResult;
      }
    }),

  /**
   * Export a file from sandbox and upload to S3, then create a persistent file record
   * This combines the previous getExportFileUploadUrl + callCodeInterpreterTool + createFileRecord flow
   * Returns a permanent /f/:id URL instead of a temporary pre-signed URL
   */
  exportAndUploadFile: marketToolProcedure
    .input(exportAndUploadFileSchema)
    .mutation(async ({ input, ctx }) => {
      const { path, filename, topicId } = input;

      log('Exporting and uploading file: %s from path: %s in topic: %s', filename, path, topicId);

      try {
        const s3 = new FileS3();

        // Use date-based sharding for privacy compliance (GDPR, CCPA)
        const today = new Date().toISOString().split('T')[0];

        // Generate a unique key for the exported file
        const key = `code-interpreter-exports/${today}/${topicId}/${filename}`;

        // Step 1: Generate pre-signed upload URL
        const uploadUrl = await s3.createPreSignedUrl(key);
        log('Generated upload URL for key: %s', key);

        // Step 2: Generate trusted client token if user info is available
        const trustedClientToken = ctx.marketUserInfo
          ? generateTrustedClientToken(ctx.marketUserInfo)
          : undefined;

        // Only require user accessToken if trusted client is not available
        let userAccessToken: string | undefined;
        if (!trustedClientToken) {
          const userState = await ctx.userModel.getUserState(async () => ({}));
          userAccessToken = userState.settings?.market?.accessToken;

          if (!userAccessToken) {
            return {
              error: { message: 'User access token not found. Please sign in to Market first.' },
              filename,
              success: false,
            } as ExportAndUploadFileResult;
          }
        } else {
          log('Using trusted client authentication for exportAndUploadFile');
        }

        // Initialize MarketSDK
        const market = new MarketSDK({
          accessToken: userAccessToken,
          baseURL: process.env.NEXT_PUBLIC_MARKET_BASE_URL,
          trustedClientToken,
        });

        // Step 3: Call sandbox's exportFile tool with the upload URL
        const response = await market.plugins.runBuildInTool(
          'exportFile',
          { path, uploadUrl },
          { topicId, userId: ctx.userId },
        );

        log('Sandbox exportFile response: %O', response);

        if (!response.success) {
          return {
            error: { message: response.error?.message || 'Failed to export file from sandbox' },
            filename,
            success: false,
          } as ExportAndUploadFileResult;
        }

        const result = response.data?.result;
        const uploadSuccess = result?.success !== false;

        if (!uploadSuccess) {
          return {
            error: { message: result?.error || 'Failed to upload file from sandbox' },
            filename,
            success: false,
          } as ExportAndUploadFileResult;
        }

        // Step 4: Get file metadata from S3 to verify upload and get actual size
        const metadata = await s3.getFileMetadata(key);
        const fileSize = metadata.contentLength;
        const mimeType = metadata.contentType || result?.mimeType || 'application/octet-stream';

        // Step 5: Create persistent file record using FileService
        // Generate a simple hash from the key (since we don't have the actual file content)
        const fileHash = sha256(key + Date.now().toString());

        const { fileId, url } = await ctx.fileService.createFileRecord({
          fileHash,
          fileType: mimeType,
          name: filename,
          size: fileSize,
          url: key, // Store S3 key
        });

        log('Created file record: fileId=%s, url=%s', fileId, url);

        return {
          fileId,
          filename,
          mimeType,
          size: fileSize,
          success: true,
          url, // This is the permanent /f/:id URL
        } as ExportAndUploadFileResult;
      } catch (error) {
        log('Error in exportAndUploadFile: %O', error);

        return {
          error: { message: (error as Error).message },
          filename,
          success: false,
        } as ExportAndUploadFileResult;
      }
    }),
});
