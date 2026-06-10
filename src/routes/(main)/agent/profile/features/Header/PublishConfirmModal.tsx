'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { createModal, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PublishConfirmContentProps {
  onConfirm: () => Promise<void>;
}

const PublishConfirmContent = memo<PublishConfirmContentProps>(({ onConfirm }) => {
  const { t: tt } = useTranslation(['setting', 'common']);
  const { close } = useModalContext();
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    try {
      setLoading(true);
      await onConfirm();
    } finally {
      setLoading(false);
      close();
    }
  };

  return (
    <Flexbox gap={20}>
      <Text type="secondary">
        {tt('marketPublish.validation.confirmPublishDesc', { ns: 'setting' })}
      </Text>
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button onClick={close}>{tt('cancel', { ns: 'common' })}</Button>
        <Button loading={loading} type="primary" onClick={handleOk}>
          {tt('ok', { ns: 'common' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

PublishConfirmContent.displayName = 'PublishConfirmContent';

export const openPublishConfirmModal = (onConfirm: () => Promise<void>) =>
  createModal({
    content: <PublishConfirmContent onConfirm={onConfirm} />,
    styles: {
      close: { flexShrink: 0 },
      header: { gap: 8 },
      title: { flex: 1, minWidth: 0 },
    },
    title: t('marketPublish.validation.confirmPublish', { ns: 'setting' }),
    width: 420,
  });
