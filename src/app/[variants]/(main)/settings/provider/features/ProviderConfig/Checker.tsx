'use client';

import { CheckCircleFilled } from '@ant-design/icons';
import { type ChatMessageError, TraceNameMap } from '@lobechat/types';
import { ModelIcon } from '@lobehub/icons';
import { Alert, Button, Flexbox, Highlighter, Icon, LobeSelect as Select } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { type ReactNode, memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
          <Flexbox paddingBlock={8} paddingInline={16}>
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
        showIcon
        title={t(`response.${error.type}` as any, { provider: providerName })}
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

    const [isProviderConfigUpdating, updateAiProviderConfig] = useAiInfraStore((s) => [
      aiProviderSelectors.isProviderConfigUpdating(provider)(s),
      s.updateAiProviderConfig,
    ]);
    const totalModels = useAiInfraStore(aiModelSelectors.aiProviderChatModelListIds);

    const [loading, setLoading] = useState(false);
    const [pass, setPass] = useState(false);
    const [checkModel, setCheckModel] = useState(model);

    const [error, setError] = useState<ChatMessageError | undefined>();

    // Sync checkModel state when model prop changes
    useEffect(() => {
      setCheckModel(model);
    }, [model]);

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
          model: checkModel,
          provider,
        },
        trace: {
          sessionId: `connection:${provider}`,
          topicId: checkModel,
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
              // Update local state
              setCheckModel(value);
              setPass(false);
              setError(undefined);

              // Persist the selected model to provider config
              // This allows the model to be retained after page refresh
              await updateAiProviderConfig(provider, { checkModel: value });
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
            icon={
              pass ? (
                <CheckCircleFilled
                  style={{
                    color: cssVar.colorSuccess,
                  }}
                />
              ) : undefined
            }
            loading={loading}
            onClick={async () => {
              await onBeforeCheck();
              try {
                await checkConnection();
              } finally {
                await onAfterCheck();
              }
            }}
            style={
              pass
                ? {
                    borderColor: cssVar.colorSuccess,
                    color: cssVar.colorSuccess,
                  }
                : undefined
            }
          >
            {pass ? t('llm.checker.pass') : t('llm.checker.button')}
          </Button>
        </Flexbox>
        {error && errorContent}
      </Flexbox>
    );
  },
);

export default Checker;
