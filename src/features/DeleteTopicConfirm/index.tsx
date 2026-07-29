'use client';

import { confirmModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import type { ReactNode } from 'react';

import { topicService } from '@/services/topic';

import { DeleteTopicConfirmContent } from './Content';

const TOPIC_FILE_CHECK_TIMEOUT_MS = 500;

interface ConfirmRemoveTopicOptions {
  content?: ReactNode;
  okText?: string;
  onConfirm: (removeFiles: boolean) => Promise<void> | void;
  title?: string;
  topicIds: string[];
}

/**
 * Open the shared topic deletion confirmation. Attachment presence is checked
 * before the dialog opens; the attachment option is shown only when at least
 * one selected topic contains an uploaded file. A failed lookup falls back to
 * showing the option so an unknown state is never mistaken for "no files".
 *
 * Cleanup stays enabled when the option is hidden: only an explicit uncheck
 * opts out of file removal.
 */
export const confirmRemoveTopic = async ({
  content,
  okText,
  onConfirm,
  title,
  topicIds,
}: ConfirmRemoveTopicOptions): Promise<void> => {
  let hasFiles = true;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutFallback = new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => resolve(true), TOPIC_FILE_CHECK_TIMEOUT_MS);
    });

    hasFiles = await Promise.race([topicService.hasTopicFiles(topicIds), timeoutFallback]);
  } catch (error) {
    console.error('[confirmRemoveTopic]', error);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  // Cleanup stays enabled even when the option is hidden: the precheck is a
  // snapshot, and files attached between it and confirm would otherwise be
  // orphaned. Server-side collection at confirm time is reference-safe and a
  // no-op when the topic truly has no files.
  const state = { removeFiles: true };

  confirmModal({
    cancelText: t('cancel', { ns: 'common' }),
    content: (
      <DeleteTopicConfirmContent
        description={content}
        showRemoveFiles={hasFiles}
        onChange={(removeFiles) => {
          state.removeFiles = removeFiles;
        }}
      />
    ),
    okButtonProps: { danger: true },
    okText: okText ?? t('actions.removeTopic', { ns: 'topic' }),
    onOk: async () => {
      await onConfirm(state.removeFiles);
    },
    title: title ?? t('actions.confirmRemoveTopicTitle', { ns: 'topic' }),
  });
};
