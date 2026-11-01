import type { UIChatMessage } from '@lobechat/types';
import pMap from 'p-map';

interface MessageFile {
  id: string;
  inaccessible?: boolean;
  url: string;
}

/** Resolve attachments without mutating the shared DB snapshot or tool payloads. */
export const resolveMessageFileUrls = async (
  messages: UIChatMessage[],
  resolveUrl: (file: MessageFile) => Promise<string>,
): Promise<UIChatMessage[]> => {
  const pendingFiles: MessageFile[] = [];
  const cloneFiles = <T extends MessageFile>(files: T[]) =>
    files.map((file) => {
      const cloned = { ...file };
      if (!cloned.inaccessible) pendingFiles.push(cloned);
      return cloned;
    });

  const cloneMessages = (list: UIChatMessage[]): UIChatMessage[] =>
    list.map((message) => ({
      ...message,
      ...(message.fileList && { fileList: cloneFiles(message.fileList) }),
      ...(message.imageList && { imageList: cloneFiles(message.imageList) }),
      ...(message.videoList && { videoList: cloneFiles(message.videoList) }),
      ...(message.audioList && { audioList: cloneFiles(message.audioList) }),
      ...(message.columns && { columns: message.columns.map(cloneMessages) }),
      ...(message.compressedMessages && {
        compressedMessages: cloneMessages(message.compressedMessages),
      }),
      ...(message.members && { members: cloneMessages(message.members) }),
    }));

  const resolved = cloneMessages(messages);
  // One shared limit across the entire tree: per-list limits would multiply
  // concurrency across messages, attachment kinds, and nested groups.
  await pMap(
    pendingFiles,
    async (file) => {
      file.url = await resolveUrl(file);
    },
    { concurrency: 10 },
  );
  return resolved;
};
