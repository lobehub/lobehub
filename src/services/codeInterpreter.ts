import { toolsClient } from '@/libs/trpc/client';
import type {
  CallToolInput,
  CallToolResult,
  GetExportFileUploadUrlInput,
  GetExportFileUploadUrlResult,
  SaveExportedFileContentInput,
  SaveExportedFileContentResult,
} from '@/server/routers/tools/codeInterpreter';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/slices/settings/selectors/settings';

/**
 * Get Market access token from user settings (stored by MarketAuthProvider)
 */
const getMarketAccessToken = (): string | undefined => {
  const settings = settingsSelectors.currentSettings(useUserStore.getState());
  return settings.market?.accessToken;
};

class CodeInterpreterService {
  /**
   * Call a cloud code interpreter tool
   * @param toolName - The name of the tool to call (e.g., 'runCommand', 'writeLocalFile')
   * @param params - The parameters for the tool
   * @param context - Session context containing userId and topicId for isolation
   */
  async callTool(
    toolName: string,
    params: Record<string, any>,
    context: { topicId: string; userId: string },
  ): Promise<CallToolResult> {
    const marketAccessToken = getMarketAccessToken();

    const input: CallToolInput = {
      marketAccessToken,
      params,
      toolName,
      topicId: context.topicId,
      userId: context.userId,
    };

    return toolsClient.codeInterpreter.callTool.mutate(input);
  }

  /**
   * Get a pre-signed upload URL for exporting a file from the sandbox
   * @param filename - The name of the file to export
   * @param topicId - The topic ID for organizing files
   */
  async getExportFileUploadUrl(
    filename: string,
    topicId: string,
  ): Promise<GetExportFileUploadUrlResult> {
    const input: GetExportFileUploadUrlInput = {
      filename,
      topicId,
    };

    return toolsClient.codeInterpreter.getExportFileUploadUrl.mutate(input);
  }

  /**
   * Save exported file content to documents table
   * This creates a document record linked to the file for content retrieval
   * @param params - File content and metadata
   */
  async saveExportedFileContent(
    params: SaveExportedFileContentInput,
  ): Promise<SaveExportedFileContentResult> {
    return toolsClient.codeInterpreter.saveExportedFileContent.mutate(params);
  }
}

export const codeInterpreterService = new CodeInterpreterService();
