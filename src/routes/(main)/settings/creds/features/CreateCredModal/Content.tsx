'use client';

import { type CredType } from '@lobechat/types';
import { useModalContext } from '@lobehub/ui/base-ui';
import { Steps } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CredTypeSelector from './CredTypeSelector';
import FileCredForm from './FileCredForm';
import KVCredForm from './KVCredForm';
import OAuthCredForm from './OAuthCredForm';

const styles = createStaticStyles(({ css }) => ({
  steps: css`
    margin-block-end: 24px;
  `,
}));

export interface CreateCredModalContentProps {
  onSuccess?: () => void;
}

const CreateCredModalContent: FC<CreateCredModalContentProps> = ({ onSuccess }) => {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();
  const [step, setStep] = useState(0);
  const [credType, setCredType] = useState<CredType | null>(null);

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
        return <KVCredForm type={credType} onBack={handleBack} onSuccess={handleSuccess} />;
      }
      case 'oauth': {
        return <OAuthCredForm onBack={handleBack} onSuccess={handleSuccess} />;
      }
      case 'file': {
        return <FileCredForm onBack={handleBack} onSuccess={handleSuccess} />;
      }
      default: {
        return null;
      }
    }
  };

  return (
    <>
      <Steps
        className={styles.steps}
        current={step}
        size={'small'}
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
