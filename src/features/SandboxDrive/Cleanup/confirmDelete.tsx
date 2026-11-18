'use client';

import {
  Alert,
  Button,
  Checkbox,
  createModal,
  Flexbox,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

interface ConfirmDeleteContentProps {
  bytes: number;
  count: number;
  onConfirm: () => Promise<void>;
  /** Every selected item is a dependency directory, cache or build output. */
  regenerable: boolean;
}

/**
 * The second confirmation a cleanup asks for. Deleting from the drive cannot
 * be undone — there is no trash on the volume — so the dialog says so in as
 * many words and keeps the delete button disabled until that sentence has
 * been acknowledged. Choosing what to delete was the first step.
 */
export const ConfirmDeleteContent = memo<ConfirmDeleteContentProps>(
  ({ bytes, count, onConfirm, regenerable }) => {
    const { t: translate } = useTranslation(['setting', 'common']);
    const { close } = useModalContext();
    const [acknowledged, setAcknowledged] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const confirm = async () => {
      setDeleting(true);
      try {
        await onConfirm();
        close();
      } catch {
        // `onConfirm` reports the failure; the dialog stays for a retry.
      } finally {
        setDeleting(false);
      }
    };

    return (
      <Flexbox gap={16}>
        <Text>
          {translate('drive.cleanup.confirm.summary', { count, size: formatSize(bytes) })}
        </Text>
        <Alert
          showIcon
          title={translate('drive.cleanup.confirm.irreversible')}
          type={'error'}
          description={translate(
            regenerable
              ? 'drive.cleanup.confirm.regenerableHint'
              : 'drive.cleanup.confirm.irreversibleHint',
          )}
        />
        <Checkbox checked={acknowledged} onChange={setAcknowledged}>
          {translate('drive.cleanup.confirm.acknowledge')}
        </Checkbox>
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={deleting} onClick={close}>
            {translate('cancel', { ns: 'common' })}
          </Button>
          <Button
            danger
            disabled={!acknowledged}
            loading={deleting}
            type={'primary'}
            onClick={confirm}
          >
            {translate('drive.cleanup.confirm.ok', { count })}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

ConfirmDeleteContent.displayName = 'StorageCleanupConfirmDelete';

export const confirmStorageDelete = (props: ConfirmDeleteContentProps): ModalInstance =>
  createModal({
    content: <ConfirmDeleteContent {...props} />,
    footer: null,
    maskClosable: false,
    styles: { header: { borderBottom: 'none' } },
    title: t('drive.cleanup.confirm.title', { count: props.count, ns: 'setting' }),
    width: 'min(90vw, 480px)',
  });
