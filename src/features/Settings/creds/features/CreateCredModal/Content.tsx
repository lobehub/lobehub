'use client';

import { type CredType } from '@lobechat/types';
import { useModalContext } from '@lobehub/ui';
import { type FC } from 'react';

import { type CredsApi } from '../useCredsApi';
import FileCredForm from './FileCredForm';
import KVCredForm, { type KVCredPreset } from './KVCredForm';
import OAuthCredForm from './OAuthCredForm';

export interface CreateCredModalContentProps {
  credsApi: CredsApi;
  /** Fields of the key-value form filled in ahead; only used with a `kv-*` type. */
  kvPreset?: KVCredPreset;
  onSuccess?: () => void;
  /** Picked from the "New credential" menu before the modal opens. */
  type: CredType;
}

const CreateCredModalContent: FC<CreateCredModalContentProps> = ({
  credsApi,
  kvPreset,
  onSuccess,
  type,
}) => {
  const { close } = useModalContext();

  const handleSuccess = () => {
    onSuccess?.();
    close();
  };

  switch (type) {
    case 'kv-env':
    case 'kv-header': {
      return (
        <KVCredForm
          credsApi={credsApi}
          preset={kvPreset}
          type={type}
          onCancel={close}
          onSuccess={handleSuccess}
        />
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
