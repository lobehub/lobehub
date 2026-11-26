import { type UIChatMessage } from '@lobechat/types';

import { cleanBotPromptTags } from '@/store/chat/utils/parseReferencedMessage';
import { unescapeMarkdown } from '@/store/chat/utils/unescapeMarkdown';
import { type UploadFileItem } from '@/types/files/upload';

export interface RestoredInput {
  /** Persisted editor JSON, present only when it round-trips rich formatting. */
  editorData?: Record<string, unknown>;
  /** Already-uploaded attachments rebuilt as composer upload items. */
  files: UploadFileItem[];
  /** Markdown text, also used to sync `inputMessage` (send-button gating). */
  markdown: string;
}

/**
 * Rebuild the composer state (text + attachments) of a sent user message.
 *
 * The attachments are already uploaded, so only their db id (send reads
 * `f.id`) and a url for the thumbnail matter; the `file` stand-in just feeds
 * the preview UI. `skipRemoveFile` marks them as references to persisted
 * files — removing one from the composer must NOT delete the file still
 * backing the original message.
 */
export const buildRestoredInput = (
  data: Pick<
    UIChatMessage,
    'audioList' | 'content' | 'editorData' | 'fileList' | 'imageList' | 'videoList'
  >,
): RestoredInput => {
  const { content, imageList, fileList, videoList, audioList, editorData } = data;

  const markdown = unescapeMarkdown(cleanBotPromptTags(content ?? ''));
  const hasEditorData =
    !!editorData && typeof editorData === 'object' && Object.keys(editorData).length > 0;

  // Media items carry no size and usually no mime, so the `file` stand-in gets
  // a type the preview (`startsWith('image'|'video')`) and the optimistic
  // message (which renders only concrete image mimes as images) both accept.
  const fromMedia = (
    list: { alt: string; id: string; mimeType?: string; url: string }[] | undefined,
    fallbackType: string,
  ): UploadFileItem[] =>
    (list ?? []).map((item) => {
      const type = item.mimeType || fallbackType;
      return {
        file: { name: item.alt || item.id, size: 0, type } as File,
        fileType: type,
        fileUrl: item.url,
        id: item.id,
        previewUrl: item.url,
        skipRemoveFile: true,
        status: 'success' as const,
      };
    });

  const files: UploadFileItem[] = [
    // `imageList` only holds formats the server renders as images, so a
    // concrete raster mime is a safe stand-in when the item has none.
    ...fromMedia(imageList, 'image/png'),
    ...fromMedia(videoList, 'video/*'),
    ...fromMedia(audioList, 'audio/*'),
    // Tombstoned attachments (viewer lost access to the file) carry no
    // name/url — nothing usable to reattach, so drop them.
    ...(fileList ?? [])
      .filter((f) => !f.inaccessible)
      .map((f) => ({
        file: { name: f.name, size: f.size, type: f.fileType } as File,
        fileUrl: f.url,
        id: f.id,
        previewUrl: f.url,
        skipRemoveFile: true,
        status: 'success' as const,
      })),
  ];

  return {
    editorData: hasEditorData ? (editorData as Record<string, unknown>) : undefined,
    files,
    markdown,
  };
};
