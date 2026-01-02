import { type CodeInterpreterToolName, MarketSDK } from '@lobehub/market-sdk';
import debug from 'debug';
import { z } from 'zod';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { generateTrustedClientToken } from '@/libs/trusted-client';
import { FileS3 } from '@/server/modules/S3';

const log = debug('lobe-server:tools:code-interpreter');

const codeInterpreterProcedure = authedProcedure.use(serverDatabase).use(marketUserInfo);

// Schema for tool call request
const callToolSchema = z.object({
  /** Market access token from OIDC (stored in user settings) */
  marketAccessToken: z.string().optional(),
  params: z.record(z.any()),
  toolName: z.string(),
  // Session context for isolation
  topicId: z.string(),
  userId: z.string(),
});

// Schema for getting export file upload URL
const getExportFileUploadUrlSchema = z.object({
  /** Original filename from sandbox */
  filename: z.string(),
  /** Topic ID for organizing files */
  topicId: z.string(),
});

// Schema for saving exported file content to document
const saveExportedFileContentSchema = z.object({
  /** File content (text content from code-interpreter export) */
  content: z.string(),
  /** File ID to associate with the document */
  fileId: z.string(),
  /** File MIME type */
  fileType: z.string(),
  /** Filename */
  filename: z.string(),
  /** File URL */
  url: z.string(),
});

export type CallToolInput = z.infer<typeof callToolSchema>;
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
  /** The download URL after file is uploaded */
  downloadUrl: string;
  error?: {
    message: string;
  };
  /** The S3 key where file will be stored */
  key: string;
  success: boolean;
  /** Pre-signed upload URL */
  uploadUrl: string;
}

export interface SaveExportedFileContentResult {
  /** Created document ID */
  documentId?: string;
  error?: {
    message: string;
  };
  success: boolean;
}

export const codeInterpreterRouter = router({
  callTool: codeInterpreterProcedure.input(callToolSchema).mutation(async ({ input, ctx }) => {
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
      // API signature: runBuildInTool(toolName, params, context, options?)
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
   * The URL can be used by the sandbox to upload the file directly to S3
   */
  getExportFileUploadUrl: codeInterpreterProcedure
    .input(getExportFileUploadUrlSchema)

    // TODO if upload success, should add it path to files db
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .mutation(async ({ ctx, input }) => {
      const { filename, topicId } = input;

      log('Generating export file upload URL for: %s in topic: %s', filename, topicId);

      try {
        const s3 = new FileS3();

        // Generate a unique key for the exported file
        // Format: code-interpreter-exports/{topicId}/{filename}
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
   * This creates a document record linked to the file, allowing content to be retrieved
   * when querying messages with file attachments
   */
  saveExportedFileContent: codeInterpreterProcedure
    .input(saveExportedFileContentSchema)
    .use(serverDatabase)
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
