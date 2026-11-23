'use client';

import { type CredType } from '@lobechat/types';
import { useModalContext } from '@lobehub/ui';
import { type FC } from 'react';

import { type CredsApi } from '../useCredsApi';
import FileCredForm from './FileCredForm';
import KVCredForm from './KVCredForm';
import OAuthCredForm from './OAuthCredForm';

export interface CreateCredModalContentProps {
  credsApi: CredsApi;
  onSuccess?: () => void;
  /** Picked from the "New credential" menu before the modal opens. */
  type: CredType;
}

const CreateCredModalContent: FC<CreateCredModalContentProps> = ({ credsApi, onSuccess, type }) => {
  const { close } = useModalContext();

  const handleSuccess = () => {
    onSuccess?.();
    close();
  };

  switch (type) {
    case 'kv-env':
    case 'kv-header': {
      return (
        <KVCredForm credsApi={credsApi} type={type} onCancel={close} onSuccess={handleSuccess} />
      );
    }
    case 'oauth': {
      return <OAuthCredForm credsApi={credsApi} onCancel={close} onSuccess={handleSuccess} />;
    }
    case 'file': {
      return <FileCredForm credsApi={credsApi} onCancel={close} onSuccess={handleSuccess} />;
    }
    default: {
      return null;
    }
  }
};

export default CreateCredModalContent;
