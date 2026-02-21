import { toolsClient } from '@/libs/trpc/client';
import {
  type CallCodeInterpreterToolInput,
  type CallToolResult,
  type ExportAndUploadFileInput,
  type ExportAndUploadFileResult,
} from '@/server/routers/tools/market';

class CloudSandboxService {
  /**
   * Call a cloud sandbox tool
   * @param toolName - The name of the tool to call (e.g., 'runCommand', 'writeLocalFile')
   * @param params - The parameters for the tool
   * @param context - Session context containing userId and topicId for isolation
   */
  async callTool(
    toolName: string,
    params: Record<string, any>,
    context: { topicId: string; userId: string },
  ): Promise<CallToolResult> {
    const input: CallCodeInterpreterToolInput = {
      params,
      toolName,
      topicId: context.topicId,
      userId: context.userId,
    };

    return toolsClient.market.callCodeInterpreterTool.mutate(input);
  }

  /**
   * Export a file from sandbox and upload to S3, then create a persistent file record
   * This is a single call that combines: getUploadUrl + callTool(exportFile) + createFileRecord
   * Returns a permanent /f/:id URL instead of a temporary pre-signed URL
   * @param path - The file path in the sandbox
   * @param filename - The name of the file to export
   * @param topicId - The topic ID for organizing files
   */
  async exportAndUploadFile(
    path: string,
    filename: string,
    topicId: string,
  ): Promise<ExportAndUploadFileResult> {
    const input: ExportAndUploadFileInput = {
      filename,
      path,
      topicId,
    };

    return toolsClient.market.exportAndUploadFile.mutate(input);
  }
}

export const cloudSandboxService = new CloudSandboxService();
