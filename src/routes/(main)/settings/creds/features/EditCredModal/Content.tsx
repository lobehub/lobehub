'use client';

import { type UserCredSummary } from '@lobechat/types';
import { useModalContext } from '@lobehub/ui/base-ui';
import { type FC } from 'react';

import EditKVForm from './EditKVForm';
import EditMetaForm from './EditMetaForm';

export interface EditCredModalContentProps {
  cred: UserCredSummary;
  onSuccess?: () => void;
}

const EditCredModalContent: FC<EditCredModalContentProps> = ({ cred, onSuccess }) => {
  const { close } = useModalContext();

  const isKVType = cred.type === 'kv-env' || cred.type === 'kv-header';

  const handleSuccess = () => {
    onSuccess?.();
    close();
  };

  return isKVType ? (
    <EditKVForm cred={cred} onCancel={close} onSuccess={handleSuccess} />
  ) : (
    <EditMetaForm cred={cred} onCancel={close} onSuccess={handleSuccess} />
  );
};

export default EditCredModalContent;
