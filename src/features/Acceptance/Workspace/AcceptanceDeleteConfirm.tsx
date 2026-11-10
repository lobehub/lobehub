'use client';

import {
  Button,
  Checkbox,
  createModal,
  Flexbox,
  type ModalInstance,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';
import { formatSize } from '@/utils/format';

import { frostedModalStyles } from '../Viewer/Review/modals';

const PREVIEW_BATCH_LIMIT = 20;

const styles = stylex.create({
  facts: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    rowGap: '4px',
    columnGap: '14px',
    margin: 0,
    paddingBlock: '10px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadiusLG,
    fontSize: '13px',
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  term: { margin: 0, color: cssVar.colorTextTertiary },
  detail: { margin: 0, color: cssVar.colorText },
});

interface DeleteConfirmProps {
  description?: string;
  ids: string[];
  onDelete: (purge: boolean) => Promise<unknown>;
  title?: string;
}

const usePurgePreview = (ids: string[]) =>
  useClientDataSWR(
    ids.length > PREVIEW_BATCH_LIMIT ? null : verifyKeys.acceptancePurgePreview(ids.join(',')),
    () => verifyService.getAcceptancePurgePreview(ids),
  );

const DeleteConfirmContent = memo<DeleteConfirmProps>(({ description, ids, onDelete, title }) => {
  const { t: translate } = useTranslation('verify');
  const { close } = useModalContext();
  const [pending, setPending] = useState(false);
  const [purge, setPurge] = useState(false);
  const { data: preview } = usePurgePreview(ids);
  const batch = ids.length > 1;
  const size = preview ? formatSize(preview.bytes) : undefined;

  const run = async () => {
    setPending(true);
    try {
      await onDelete(purge);
      close();
    } catch (error) {
      console.error('[acceptance:deleteConfirm]', error);
      toast.error(translate('acceptance.workspace.deleteError'));
    } finally {
      setPending(false);
    }
  };

  const okLabel =
    !purge || !size
      ? batch
        ? translate('acceptance.workspace.deleteConfirm.okBatchPlain', { count: ids.length })
        : translate('actions.delete')
      : batch
        ? translate('acceptance.workspace.deleteConfirm.okBatch', { count: ids.length, size })
        : translate('acceptance.workspace.deleteConfirm.ok', { size });

  return (
    <Flexbox gap={12}>
      <Text fontSize={13} type={purge ? 'danger' : 'secondary'}>
        {purge
          ? translate('acceptance.workspace.deleteConfirm.purgeWarning')
          : batch
            ? translate('acceptance.workspace.batch.deleteConfirmDescription', {
                count: ids.length,
              })
            : translate('acceptance.workspace.deleteConfirmDescription', { title })}
      </Text>
      {description && (
        <Text fontSize={13} type={'secondary'}>
          {description}
        </Text>
      )}
      <Checkbox checked={purge} onChange={setPurge}>
        {size
          ? translate('acceptance.workspace.deleteConfirm.purgeOption', { size })
          : translate('acceptance.workspace.deleteConfirm.purgeOptionPlain')}
      </Checkbox>
      {purge && preview && (
        <dl {...stylex.props(styles.facts)}>
          <dt {...stylex.props(styles.term)}>
            {translate('acceptance.workspace.deleteConfirm.rounds')}
          </dt>
          <dd {...stylex.props(styles.detail)}>
            {translate('acceptance.workspace.deleteConfirm.roundsValue', { count: preview.rounds })}
          </dd>
          <dt {...stylex.props(styles.term)}>
            {translate('acceptance.workspace.deleteConfirm.files')}
          </dt>
          <dd {...stylex.props(styles.detail)}>
            {translate('acceptance.workspace.deleteConfirm.filesValue', {
              count: preview.fileCount,
              ...preview.files,
            })}
          </dd>
          <dt {...stylex.props(styles.term)}>
            {translate('acceptance.workspace.deleteConfirm.space')}
          </dt>
          <dd {...stylex.props(styles.detail)}>{formatSize(preview.bytes)}</dd>
        </dl>
      )}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={pending} onClick={close}>
          {translate('actions.cancel')}
        </Button>
        <Button danger loading={pending} type={'primary'} onClick={() => void run()}>
          {okLabel}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

DeleteConfirmContent.displayName = 'AcceptanceDeleteConfirmContent';

export const openAcceptanceDeleteConfirm = (options: DeleteConfirmProps): ModalInstance =>
  createModal({
    content: <DeleteConfirmContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: frostedModalStyles,
    title:
      options.ids.length > 1
        ? t('acceptance.workspace.batch.deleteConfirmTitle', {
            count: options.ids.length,
            ns: 'verify',
          })
        : t('acceptance.workspace.deleteConfirmTitle', { ns: 'verify', title: options.title }),
    width: 'min(90vw, 440px)',
  });
