import { App } from 'antd';
import { Undo2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cleanSpeakerTag } from '@/store/chat/utils/cleanSpeakerTag';
import { unescapeMarkdown } from '@/store/chat/utils/unescapeMarkdown';
import { useFileStore } from '@/store/file';
import { type UploadFileItem } from '@/types/files/upload';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

/**
 * Restore a previously sent user message — its text plus every image/file
 * attachment — back into the ChatInput composer, so the user can resend it.
 *
 * Motivated by long agent runs that error out or lose memory: re-attaching a
 * pile of images by hand is painful, so we rebuild the exact input state from
 * the persisted message instead.
 */
export const restoreToInputAction = defineAction({
  key: 'restoreToInput',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const { message } = App.useApp();
    const editor = useConversationStore((s) => s.editor);
    const updateInputMessage = useConversationStore((s) => s.updateInputMessage);

    return useMemo(() => {
      // Only user messages carry restorable user input.
      if (ctx.role !== 'user') return null;

      return {
        handleClick: () => {
          if (!editor) return;

          const { content, imageList, fileList, videoList, audioList, editorData } = ctx.data;

          // 1. Restore text. Prefer the persisted editor JSON (round-trips rich
          //    formatting) and fall back to the markdown content otherwise.
          const markdown = unescapeMarkdown(cleanSpeakerTag(content ?? ''));
          const hasEditorData =
            editorData && typeof editorData === 'object' && Object.keys(editorData).length > 0;

          if (hasEditorData) {
            editor.setJSONState(editorData);
          } else {
            editor.setDocument('markdown', markdown);
          }
          // Keep ConversationStore's inputMessage in sync — setDocument does not
          // fire onMarkdownContentChange, and the send-button gating reads it.
          updateInputMessage(markdown);

          // 2. Rebuild the pending attachments. These files are already uploaded,
          //    so we only need their db id (send reads `f.id`) plus a url for the
          //    thumbnail; the `file` stand-in just feeds the preview UI.
          //    `skipRemoveFile` marks them as references to already-persisted
          //    files — removing one from the composer must NOT delete the file
          //    still backing the original message.
          // `alt`-only items (image/video/audio) carry no size or mime, so the
          // `file` stand-in gets a generic `type` prefix good enough for the
          // preview's `startsWith('image'|'video')` branch.
          const fromMedia = (
            list: { alt: string; id: string; url: string }[] | undefined,
            typePrefix: string,
          ): UploadFileItem[] =>
            (list ?? []).map((item) => ({
              file: { name: item.alt || item.id, size: 0, type: `${typePrefix}/*` } as File,
              fileUrl: item.url,
              id: item.id,
              previewUrl: item.url,
              skipRemoveFile: true,
              status: 'success' as const,
            }));

          const restored: UploadFileItem[] = [
            ...fromMedia(imageList, 'image'),
            ...fromMedia(videoList, 'video'),
            ...fromMedia(audioList, 'audio'),
            ...(fileList ?? []).map((f) => ({
              file: { name: f.name, size: f.size, type: f.fileType } as File,
              fileUrl: f.url,
              id: f.id,
              previewUrl: f.url,
              skipRemoveFile: true,
              status: 'success' as const,
            })),
          ];

          const fileStore = useFileStore.getState();
          fileStore.clearChatUploadFileList();
          if (restored.length > 0) {
            fileStore.dispatchChatUploadFileList({ files: restored, type: 'addFiles' });
          }

          editor.focus();
          message.success(t('restoreToInputSuccess'));
        },
        icon: Undo2,
        key: 'restoreToInput',
        label: t('restoreToInput'),
      };
    }, [t, message, ctx.role, ctx.data, editor, updateInputMessage]);
  },
});
