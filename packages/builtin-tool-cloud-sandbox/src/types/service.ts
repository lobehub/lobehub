// ==================== Sandbox Service Interface ====================

/**
 * Result of calling a sandbox tool
 */
export interface SandboxCallToolResult {
  error?: { message: string; name?: string };
  result: any;
  sessionExpiredAndRecreated?: boolean;
  success: boolean;
}

/**
 * Result of exporting and uploading a file from sandbox
 */
export interface SandboxExportFileResult {
  error?: { message: string };
  fileId?: string;
  filename: string;
  mimeType?: string;
  size?: number;
  success: boolean;
  url?: string;
}

/**
 * Sandbox Service Interface - for dependency injection
 *
 * Context (topicId, userId) is bound at service creation time, not passed per-call.
 * This allows CloudSandboxExecutionRuntime to work on both client and server:
 * - Client: Implemented via tRPC client (codeInterpreterService)
 * - Server: Implemented via MarketSDK directly (ServerSandboxService)
 */
export interface ISandboxService {
  /**
   * Call a sandbox tool
   * @param toolName - The name of the tool to call (e.g., 'runCommand', 'writeLocalFile')
   * @param params - The parameters for the tool
   */
  callTool: (toolName: string, params: Record<string, any>) => Promise<SandboxCallToolResult>;

  /**
   * Export a file from sandbox and upload to cloud storage
   * @param path - The file path in the sandbox
   * @param filename - The name of the file to export
   */
  exportAndUploadFile: (path: string, filename: string) => Promise<SandboxExportFileResult>;
}
