import { cloudSandboxService } from '@/services/cloudSandbox';
import { projectFileService } from '@/services/projectFile';

interface WorkspaceHtmlPublishFileOpsInput {
  deviceId?: string;
  sandboxTopicId?: string;
  workingDirectory: string;
}

export interface WorkspaceHtmlPublishFileOps {
  copyFile: (from: string, to: string) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
}

const quoteShellArg = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const posixDirname = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';

const assertSuccess = (
  result: { error?: string | { message?: string }; success: boolean },
  fallback: string,
) => {
  if (result.success) return;
  const message = typeof result.error === 'string' ? result.error : result.error?.message;
  throw new Error(message || fallback);
};

export const createWorkspaceHtmlPublishFileOps = ({
  deviceId,
  sandboxTopicId,
  workingDirectory,
}: WorkspaceHtmlPublishFileOpsInput): WorkspaceHtmlPublishFileOps => {
  if (sandboxTopicId) {
    return {
      copyFile: async (from, to) => {
        const result = await cloudSandboxService.callTool(
          'runCommand',
          {
            command: `mkdir -p ${quoteShellArg(posixDirname(to))} && cp ${quoteShellArg(from)} ${quoteShellArg(to)}`,
            description: 'Copy publish asset into workspace',
          },
          { topicId: sandboxTopicId },
        );
        assertSuccess(result, 'Failed to copy publish asset');
      },
      writeFile: async (path, content) => {
        const result = await cloudSandboxService.callTool(
          'writeFile',
          { content, createDirectories: true, path },
          { topicId: sandboxTopicId },
        );
        assertSuccess(result, 'Failed to write publish file');
      },
    };
  }

  return {
    copyFile: async (from, to) => {
      const result = await projectFileService.copyAssetForPublish({
        deviceId,
        from,
        to,
        workingDirectory,
      });
      assertSuccess(result, 'Failed to copy publish asset');
    },
    writeFile: async (path, content) => {
      const result = await projectFileService.writeProjectFile({
        content,
        deviceId,
        path,
        workingDirectory,
      });
      assertSuccess(result, 'Failed to write publish file');
    },
  };
};
