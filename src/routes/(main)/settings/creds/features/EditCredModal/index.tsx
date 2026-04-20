'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Modal } from '@lobehub/ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import EditKVForm from './EditKVForm';
import EditMetaForm from './EditMetaForm';

interface EditCredModalProps {
  cred: UserCredSummary | null;
  onClose: () => void;
  onSuccess: () => void;
  open: boolean;
}

const EditCredModal: FC<EditCredModalProps> = ({ open, onClose, onSuccess, cred }) => {
  const { t } = useTranslation('setting');

  if (!cred) return null;

  const isKVType = cred.type === 'kv-env' || cred.type === 'kv-header';

  const handleSuccess = () => {
    onSuccess();
    onClose();
  };

  return (
    <Modal
      destroyOnClose
      footer={null}
      open={open}
      title={t('creds.edit.title')}
      width={520}
      onCancel={onClose}
    >
      {isKVType ? (
        <EditKVForm cred={cred} onCancel={onClose} onSuccess={handleSuccess} />
      ) : (
        <EditMetaForm cred={cred} onCancel={onClose} onSuccess={handleSuccess} />
      )}
    </Modal>
  );
};

export default EditCredModal;
