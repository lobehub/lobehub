'use client';

import { confirmModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import DeleteTopicConfirmContent from './Content';

/**
 * Open the "delete topic" confirmation dialog. The dialog includes a checkbox —
 * checked by default — to also delete images/files uploaded in the topic, so
 * removing a conversation doesn't leave orphaned attachments in storage.
 *
 * @param onConfirm invoked on confirm with the current checkbox value.
 */
export const confirmRemoveTopic = (onConfirm: (removeFiles: boolean) => Promise<void> | void) => {
  // Default to removing attachments to avoid orphaned storage.
  const state = { removeFiles: true };

  confirmModal({
    cancelText: t('cancel', { ns: 'common' }),
    content: (
      <DeleteTopicConfirmContent
        onChange={(removeFiles) => {
          state.removeFiles = removeFiles;
        }}
      />
    ),
    okButtonProps: { danger: true },
    okText: t('actions.removeTopic', { ns: 'topic' }),
    onOk: async () => {
      await onConfirm(state.removeFiles);
    },
    title: t('actions.confirmRemoveTopicTitle', { ns: 'topic' }),
  });
};
