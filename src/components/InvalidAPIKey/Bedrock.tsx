import { Aws } from '@lobehub/icons';
import { Button, Icon, InputPassword, Select } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Network, ShieldPlus } from 'lucide-react';
import { ModelProvider } from 'model-bank';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormAction } from '@/features/Conversation/Error/style';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

const BedrockForm = memo<{ description: string }>(({ description }) => {
  const { t } = useTranslation('modelProvider');
  const [showRegion, setShow] = useState(false);
  const [showSessionToken, setShowSessionToken] = useState(false);

  const config = useAiInfraStore(aiProviderSelectors.providerKeyVaults(ModelProvider.Bedrock));
  const setConfig = useAiInfraStore((s) => s.updateAiProviderConfig);
  const { accessKeyId, secretAccessKey, sessionToken, region } = config || {};

  return (
    <FormAction
      avatar={<Aws.Color color={cssVar.colorText} size={56} />}
      description={description}
      title={t('bedrock.unlock.title')}
    >
      <InputPassword
        autoComplete={'new-password'}
        placeholder={'Aws Access Key Id'}
        value={accessKeyId}
        variant={'filled'}
        onChange={(e) => {
          setConfig(ModelProvider.Bedrock, { keyVaults: { accessKeyId: e.target.value } });
        }}
      />
      <InputPassword
        autoComplete={'new-password'}
        placeholder={'Aws Secret Access Key'}
        value={secretAccessKey}
        variant={'filled'}
        onChange={(e) => {
          setConfig(ModelProvider.Bedrock, { keyVaults: { secretAccessKey: e.target.value } });
        }}
      />
      {showSessionToken ? (
        <InputPassword
          autoComplete={'new-password'}
          placeholder={'Aws Session Token'}
          value={sessionToken}
          variant={'filled'}
          onChange={(e) => {
            setConfig(ModelProvider.Bedrock, { keyVaults: { sessionToken: e.target.value } });
          }}
        />
      ) : (
        <Button
          block
          icon={ShieldPlus}
          type={'text'}
          onClick={() => {
            setShowSessionToken(true);
          }}
        >
          {t('bedrock.unlock.customSessionToken')}
        </Button>
      )}
      {showRegion ? (
        <Select
          placeholder={'https://api.openai.com/v1'}
          style={{ width: '100%' }}
          value={region}
          options={['us-east-1', 'us-west-2', 'ap-southeast-1', 'eu-central-1'].map((i) => ({
            label: i,
            value: i,
          }))}
          onChange={(region) => {
            setConfig('bedrock', { keyVaults: { region } });
          }}
        />
      ) : (
        <Button
          block
          icon={<Icon icon={Network} />}
          type={'text'}
          onClick={() => {
            setShow(true);
          }}
        >
          {t('bedrock.unlock.customRegion')}
        </Button>
      )}
    </FormAction>
  );
});

export default BedrockForm;
