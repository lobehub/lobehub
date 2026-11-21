'use client';

import { type CredType } from '@lobechat/types';
import { Steps, useModalContext } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type CredsApi } from '../useCredsApi';
import CredTypeSelector from './CredTypeSelector';
import FileCredForm from './FileCredForm';
import KVCredForm from './KVCredForm';
import OAuthCredForm from './OAuthCredForm';

const styles = stylex.create({ steps: { marginBlockEnd: '24px' } });

export interface CreateCredModalContentProps {
  credsApi: CredsApi;
  /**
   * The type already picked from the vault's create menu: the modal opens on
   * its form, and Back still leads to the type step.
   */
  initialType?: CredType;
  onSuccess?: () => void;
}

const CreateCredModalContent: FC<CreateCredModalContentProps> = ({
  credsApi,
  initialType,
  onSuccess,
}) => {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();
  const [step, setStep] = useState(initialType ? 1 : 0);
  const [credType, setCredType] = useState<CredType | null>(initialType ?? null);

  const handleTypeSelect = (type: CredType) => {
    setCredType(type);
    setStep(1);
  };

  const handleBack = () => {
    setStep(0);
    setCredType(null);
  };

  const handleSuccess = () => {
    onSuccess?.();
    close();
  };

  const renderForm = () => {
    switch (credType) {
      case 'kv-env':
      case 'kv-header': {
        return (
          <KVCredForm
            credsApi={credsApi}
            type={credType}
            onBack={handleBack}
            onSuccess={handleSuccess}
          />
        );
      }
      case 'oauth': {
        return <OAuthCredForm credsApi={credsApi} onBack={handleBack} onSuccess={handleSuccess} />;
      }
      case 'file': {
        return <FileCredForm credsApi={credsApi} onBack={handleBack} onSuccess={handleSuccess} />;
      }
      default: {
        return null;
      }
    }
  };

  return (
    <>
      <Steps
        className={stylex.props(styles.steps).className}
        current={step}
        items={[
          { title: t('creds.createModal.selectType') },
          { title: t('creds.createModal.fillForm') },
        ]}
      />

      {step === 0 ? <CredTypeSelector onSelect={handleTypeSelect} /> : renderForm()}
    </>
  );
};

export default CreateCredModalContent;
