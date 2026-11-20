'use client';

import { type UserCredSummary } from '@lobechat/types';
import { useModalContext } from '@lobehub/ui';
import { type FC } from 'react';

import { type CredsApi } from '../useCredsApi';
import EditKVForm from './EditKVForm';
import EditMetaForm from './EditMetaForm';

export interface EditCredModalContentProps {
  cred: UserCredSummary;
  credsApi: CredsApi;
  onSuccess?: () => void;
}

const EditCredModalContent: FC<EditCredModalContentProps> = ({ cred, credsApi, onSuccess }) => {
  const { close } = useModalContext();

  const isKVType = cred.type === 'kv-env' || cred.type === 'kv-header';

  const handleSuccess = () => {
    onSuccess?.();
    close();
  };

  return isKVType ? (
    <EditKVForm cred={cred} credsApi={credsApi} onCancel={close} onSuccess={handleSuccess} />
  ) : (
    <EditMetaForm cred={cred} credsApi={credsApi} onCancel={close} onSuccess={handleSuccess} />
  );
};

export default EditCredModalContent;
