'use client';

import { Button, createModal, ModalFooter, useModalContext } from '@lobehub/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ConfirmCredModalConfig {
  content?: ReactNode;
  /** Red confirm button, for removing or revoking. */
  danger?: boolean;
  okText: ReactNode;
  /** Runs on confirm; the dialog stays open, loading, until it settles, and closes unless it throws. */
  onOk: () => unknown | Promise<unknown>;
  title: ReactNode;
}

const ConfirmBody = ({ content, danger, okText, onOk }: ConfirmCredModalConfig) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    setLoading(true);
    try {
      await onOk();
      close();
    } catch {
      // The caller reports its own failure; keep the dialog open to retry.
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {content && <div style={{ padding: '12px 16px' }}>{content}</div>}
      <ModalFooter>
        <Button type={'fill'} onClick={close}>
          {t('cancel')}
        </Button>
        <Button danger={danger} loading={loading} type={'primary'} onClick={handleOk}>
          {okText}
        </Button>
      </ModalFooter>
    </>
  );
};

/**
 * The vault's confirmation dialog: `confirmModal`'s layout, with Cancel in the
 * fill variant like every other secondary button in the vault (`confirmModal`
 * offers no way to style its Cancel).
 */
export const confirmCredModal = (config: ConfirmCredModalConfig) =>
  createModal({
    content: <ConfirmBody {...config} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: config.title,
    width: 420,
  });
