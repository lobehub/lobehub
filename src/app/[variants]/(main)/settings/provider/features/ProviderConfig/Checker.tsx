'use client';

import { CheckCircleFilled } from '@ant-design/icons';
import { ChatMessageError, TraceNameMap } from '@lobechat/types';
import { ModelIcon } from '@lobehub/icons';
import { Alert, Button, Highlighter, Icon, Select } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { ReactNode, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useProviderName } from '@/hooks/useProviderName';
import { chatService } from '@/services/chat';
import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

const Error = memo<{ error: ChatMessageError }>(({ error }) => {
  const { t } = useTranslation('error');
  const providerName = useProviderName(error.body?.provider);

  return (
    <Flexbox gap={8} style={{ maxWidth: 600, width: '100%' }}>
      <Alert
        extra={
          <Flexbox>
            <Highlighter
              actionIconSize={'small'}
              language={'json'}
              variant={'borderless'}
              wrap={true}
            >
              {JSON.stringify(error.body || error, null, 2)}
            </Highlighter>
          </Flexbox>
        }
        message={t(`response.${error.type}` as any, { provider: providerName })}
        showIcon
        type={'error'}
      />
    </Flexbox>
  );
});

export type CheckErrorRender = (props: {
  defaultError: ReactNode;
  error?: ChatMessageError;
  setError: (error?: ChatMessageError) => void;
}) => ReactNode;

interface ConnectionCheckerProps {
  checkErrorRender?: CheckErrorRender;
  model: string;
  onAfterCheck: () => Promise<void>;
  onBeforeCheck: () => Promise<void>;
  provider: string;
}

const Checker = memo<ConnectionCheckerProps>(
  ({ model, provider, checkErrorRender: CheckErrorRender, onBeforeCheck, onAfterCheck }) => {
    const { t } = useTranslation('setting');

    const isProviderConfigUpdating = useAiInfraStore(
      aiProviderSelectors.isProviderConfigUpdating(provider),
    );
    const totalModels = useAiInfraStore(aiModelSelectors.aiProviderChatModelListIds);
    const updateAiProviderConfig = useAiInfraStore((s) => s.updateAiProviderConfig);
    const currentConfig = useAiInfraStore(aiProviderSelectors.providerConfigById(provider));

    const [loading, setLoading] = useState(false);
    const [pass, setPass] = useState(false);
    const [checkModel, setCheckModel] = useState(model);

    const theme = useTheme();
    const [error, setError] = useState<ChatMessageError | undefined>();

    const checkConnection = async () => {
      // Clear previous check results immediately
      setPass(false);
      setError(undefined);

      let isError = false;

      await chatService.fetchPresetTaskResult({
        onError: (_, rawError) => {
          setError(rawError);
          setPass(false);
          isError = true;
        },

        onFinish: async (value) => {
          if (!isError && value) {
            setError(undefined);
            setPass(true);
          } else {
            setPass(false);
            setError({
              body: value,
              message: t('response.ConnectionCheckFailed', { ns: 'error' }),
              type: 'ConnectionCheckFailed',
            });
          }
        },
        onLoadingChange: (loading) => {
          setLoading(loading);
        },
        params: {
          messages: [
            {
              content: 'hello',
              role: 'user',
            },
          ],
          model,
          provider,
        },
        trace: {
          sessionId: `connection:${provider}`,
          topicId: model,
          traceName: TraceNameMap.ConnectivityChecker,
        },
      });
    };

    const defaultError = error ? <Error error={error as ChatMessageError} /> : null;

    const errorContent = CheckErrorRender ? (
      <CheckErrorRender defaultError={defaultError} error={error} setError={setError} />
    ) : (
      defaultError
    );

    return (
      <Flexbox gap={8}>
        <Flexbox gap={8} horizontal>
          <Select
            listItemHeight={36}
            onSelect={async (value) => {
              setCheckModel(value);
              await updateAiProviderConfig(provider, {
                ...currentConfig,
                checkModel: value,
              });
            }}
            optionRender={({ value }) => {
              return (
                <Flexbox align={'center'} gap={6} horizontal>
                  <ModelIcon model={value as string} size={20} />
                  {value}
                </Flexbox>
              );
            }}
            options={totalModels.map((id) => ({ label: id, value: id }))}
            style={{
              flex: 1,
              overflow: 'hidden',
            }}
            suffixIcon={isProviderConfigUpdating && <Icon icon={Loader2Icon} spin />}
            value={checkModel}
            virtual
          />
          <Button
            disabled={isProviderConfigUpdating}
            loading={loading}
            onClick={async () => {
              await onBeforeCheck();
              try {
                await checkConnection();
              } finally {
                await onAfterCheck();
              }
            }}
          >
            {t('llm.checker.button')}
          </Button>
        </Flexbox>

        {pass && (
          <Flexbox gap={4} horizontal>
            <CheckCircleFilled
              style={{
                color: theme.colorSuccess,
              }}
            />
            {t('llm.checker.pass')}
          </Flexbox>
        )}
        {error && errorContent}
      </Flexbox>
    );
  },
);

export default Checker;
