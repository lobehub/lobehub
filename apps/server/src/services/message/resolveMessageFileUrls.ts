import type { UIChatMessage } from '@lobechat/types';

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
  const resolveFiles = <T extends MessageFile>(files: T[]) =>
    Promise.all(
      files.map(async (file) =>
        file.inaccessible ? { ...file } : { ...file, url: await resolveUrl(file) },
      ),
    );

  return Promise.all(
    messages.map(async (message) => {
      const [fileList, imageList, videoList, audioList, columns, compressedMessages, members] =
        await Promise.all([
          message.fileList && resolveFiles(message.fileList),
          message.imageList && resolveFiles(message.imageList),
          message.videoList && resolveFiles(message.videoList),
          message.audioList && resolveFiles(message.audioList),
          message.columns &&
            Promise.all(
              message.columns.map((column) => resolveMessageFileUrls(column, resolveUrl)),
            ),
          message.compressedMessages &&
            resolveMessageFileUrls(message.compressedMessages, resolveUrl),
          message.members && resolveMessageFileUrls(message.members, resolveUrl),
        ]);
      return {
        ...message,
        ...(fileList && { fileList }),
        ...(imageList && { imageList }),
        ...(videoList && { videoList }),
        ...(audioList && { audioList }),
        ...(columns && { columns }),
        ...(compressedMessages && { compressedMessages }),
        ...(members && { members }),
      };
    }),
  );
};
