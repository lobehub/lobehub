import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import type { ListLocalFilesResult, LocalReadFileResult } from '@lobechat/electron-client-ipc';
import { formatFileContent, formatFileList } from '@lobechat/prompts';
import type { LocalSystemToolSnapshot } from '@lobechat/types';
import { nanoid } from 'nanoid';

import { localFileService } from '@/services/electron/localFileService';

import type { ParsedLocalFileReference } from './commandBus/parseCommands';

const DEFAULT_DIRECTORY_LIMIT = 100;

const createSnapshotId = () => `local-system-snapshot-${nanoid()}`;

const createToolCallId = (snapshotId: string) => `call_${snapshotId}`;

const normalizeReadResult = (result: LocalReadFileResult) => ({
  charCount: result.charCount,
  content: result.content,
  fileType: result.fileType,
  filename: result.filename,
  loc: result.loc,
  totalCharCount: result.totalCharCount,
  totalLineCount: result.totalLineCount,
});

const createReadSnapshot = async (
  reference: ParsedLocalFileReference,
  capturedAt: string,
): Promise<LocalSystemToolSnapshot> => {
  const snapshotId = createSnapshotId();
  const args = { path: reference.path };

  try {
    const result = await localFileService.readLocalFile(args);
    const content = formatFileContent({
      content: result.content,
      lineRange: result.loc,
      path: reference.path,
    });
    const state = {
      charCount: result.charCount,
      content: result.content,
      fileType: result.fileType,
      filename: result.filename,
      loc: result.loc,
      path: reference.path,
      totalCharCount: result.totalCharCount,
      totalLines: result.totalLineCount,
    };

    return {
      apiName: LocalSystemApiName.readFile,
      arguments: args,
      capturedAt,
      content,
      identifier: LocalSystemIdentifier,
      result: normalizeReadResult(result),
      snapshotId,
      state,
      success: true,
      toolCallId: createToolCallId(snapshotId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      apiName: LocalSystemApiName.readFile,
      arguments: args,
      capturedAt,
      content: message,
      error: { message, type: 'LocalFileReadError' },
      identifier: LocalSystemIdentifier,
      snapshotId,
      success: false,
      toolCallId: createToolCallId(snapshotId),
    };
  }
};

const normalizeListResult = (result: ListLocalFilesResult) => ({
  files: result.files,
  totalCount: result.totalCount,
});

const createListSnapshot = async (
  reference: ParsedLocalFileReference,
  capturedAt: string,
): Promise<LocalSystemToolSnapshot> => {
  const snapshotId = createSnapshotId();
  const args = { limit: DEFAULT_DIRECTORY_LIMIT, path: reference.path };

  try {
    const result = await localFileService.listLocalFiles(args);
    const content = formatFileList({
      directory: reference.path,
      files: result.files.map((file) => ({
        isDirectory: file.isDirectory,
        name: file.name,
      })),
      totalCount: result.totalCount,
    });

    return {
      apiName: LocalSystemApiName.listFiles,
      arguments: args,
      capturedAt,
      content,
      identifier: LocalSystemIdentifier,
      result: normalizeListResult(result),
      snapshotId,
      state: normalizeListResult(result),
      success: true,
      toolCallId: createToolCallId(snapshotId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      apiName: LocalSystemApiName.listFiles,
      arguments: args,
      capturedAt,
      content: message,
      error: { message, type: 'LocalDirectoryListError' },
      identifier: LocalSystemIdentifier,
      snapshotId,
      success: false,
      toolCallId: createToolCallId(snapshotId),
    };
  }
};

export const materializeLocalSystemToolSnapshots = async (
  references: ParsedLocalFileReference[],
): Promise<LocalSystemToolSnapshot[]> => {
  if (references.length === 0) return [];

  const capturedAt = new Date().toISOString();

  return Promise.all(
    references.map((reference) =>
      reference.isDirectory
        ? createListSnapshot(reference, capturedAt)
        : createReadSnapshot(reference, capturedAt),
    ),
  );
};
