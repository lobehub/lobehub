import { type CodeInterpreterToolName, MarketSDK } from '@lobehub/market-sdk';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { type ToolCallContent } from '@/libs/mcp';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase, telemetry } from '@/libs/trpc/lambda/middleware';
import { generateTrustedClientToken } from '@/libs/trusted-client';
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

// Schema for getting export file upload URL
const getExportFileUploadUrlSchema = z.object({
  filename: z.string(),
  topicId: z.string(),
});

// Schema for saving exported file content to document
const saveExportedFileContentSchema = z.object({
  content: z.string(),
  fileId: z.string(),
  fileType: z.string(),
  filename: z.string(),
  url: z.string(),
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
export type GetExportFileUploadUrlInput = z.infer<typeof getExportFileUploadUrlSchema>;
export type SaveExportedFileContentInput = z.infer<typeof saveExportedFileContentSchema>;

export interface CallToolResult {
  error?: {
    message: string;
    name?: string;
  };
  result: any;
  sessionExpiredAndRecreated?: boolean;
  success: boolean;
}

export interface GetExportFileUploadUrlResult {
  downloadUrl: string;
  error?: {
    message: string;
  };
  key: string;
  success: boolean;
  uploadUrl: string;
}

export interface SaveExportedFileContentResult {
  documentId?: string;
  error?: {
    message: string;
  };
  success: boolean;
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
        // Query user_settings to get market.accessToken
        const userState = await ctx.userModel.getUserState(async () => ({}));
        const userAccessToken = userState.settings?.market?.accessToken;

        log('callCloudMcpEndpoint: userAccessToken exists=%s', !!userAccessToken);

        if (!userAccessToken) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'User access token not found. Please sign in to Market first.',
          });
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
   * Generate a pre-signed upload URL for exporting files from sandbox
   */
  getExportFileUploadUrl: marketToolProcedure
    .input(getExportFileUploadUrlSchema)
    .mutation(async ({ input }) => {
      const { filename, topicId } = input;

      log('Generating export file upload URL for: %s in topic: %s', filename, topicId);

      try {
        const s3 = new FileS3();

        // Generate a unique key for the exported file
        const key = `code-interpreter-exports/${topicId}/${filename}`;

        // Generate pre-signed upload URL
        const uploadUrl = await s3.createPreSignedUrl(key);

        // Generate download URL (pre-signed for preview)
        const downloadUrl = await s3.createPreSignedUrlForPreview(key);

        log('Generated upload URL for key: %s', key);

        return {
          downloadUrl,
          key,
          success: true,
          uploadUrl,
        } as GetExportFileUploadUrlResult;
      } catch (error) {
        log('Error generating export file upload URL: %O', error);

        return {
          downloadUrl: '',
          error: {
            message: (error as Error).message,
          },
          key: '',
          success: false,
          uploadUrl: '',
        } as GetExportFileUploadUrlResult;
      }
    }),

  /**
   * Save exported file content to documents table
   */
  saveExportedFileContent: marketToolProcedure
    .input(saveExportedFileContentSchema)
    .mutation(async ({ ctx, input }) => {
      const { content, fileId, fileType, filename, url } = input;

      log('Saving exported file content: fileId=%s, filename=%s', fileId, filename);

      try {
        const documentModel = new DocumentModel(ctx.serverDB, ctx.userId);
        const fileModel = new FileModel(ctx.serverDB, ctx.userId);

        // Verify the file exists
        const file = await fileModel.findById(fileId);
        if (!file) {
          return {
            error: { message: 'File not found' },
            success: false,
          } as SaveExportedFileContentResult;
        }

        // Create document record with the file content
        const document = await documentModel.create({
          content,
          fileId,
          fileType,
          filename,
          source: url,
          sourceType: 'file',
          title: filename,
          totalCharCount: content.length,
          totalLineCount: content.split('\n').length,
        });

        log('Created document for exported file: documentId=%s, fileId=%s', document.id, fileId);

        return {
          documentId: document.id,
          success: true,
        } as SaveExportedFileContentResult;
      } catch (error) {
        log('Error saving exported file content: %O', error);

        return {
          error: { message: (error as Error).message },
          success: false,
        } as SaveExportedFileContentResult;
      }
    }),
});
