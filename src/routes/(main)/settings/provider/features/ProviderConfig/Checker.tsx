'use client';

import { CheckCircleFilled } from '@ant-design/icons';
import { type ChatMessageError } from '@lobechat/types';
import { TraceNameMap } from '@lobechat/types';
import { ModelIcon } from '@lobehub/icons';
import { Alert, Button, Flexbox, Highlighter, Icon, LobeSelect as Select } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProviderName } from '@/hooks/useProviderName';
import { chatService } from '@/services/chat';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

const styles = createStaticStyles(({ css }) => ({
  popup: css`
    width: 380px;
  `,
}));
const Error = memo<{ error: ChatMessageError }>(({ error }) => {
  const { t } = useTranslation('error');
  const providerName = useProviderName(error.body?.provider);

  return (
    <Flexbox gap={8} style={{ maxWidth: 600, width: '100%' }}>
      <Alert
        showIcon
        title={t(`response.${error.type}` as any, { provider: providerName })}
        type={'error'}
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
    const aiProviderModelList = useAiInfraStore((s) => s.aiProviderModelList);

    // Sort models for better UX:
    // 1. checkModel first (provider's recommended test model)
    // 2. enabled models (user is actively using)
    // 3. by releasedAt descending (newer models first)
    // 4. models without releasedAt last
    const sortedModels = useMemo(() => {
      const chatModels = aiProviderModelList.filter((m) => m.type === 'chat');

      const sorted = [...chatModels].sort((a, b) => {
        // checkModel always first
        if (a.id === model) return -1;
        if (b.id === model) return 1;

        // enabled models come before disabled
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;

        // sort by releasedAt descending, models without releasedAt go last
        if (a.releasedAt && b.releasedAt) {
          return new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime();
        }
        if (a.releasedAt && !b.releasedAt) return -1;
        if (!a.releasedAt && b.releasedAt) return 1;

        return 0;
      });

      return sorted.map((m) => m.id);
    }, [aiProviderModelList, model]);

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
        <Flexbox horizontal gap={8}>
          <Select
            virtual
            listItemHeight={36}
            options={sortedModels.map((id) => ({ label: id, value: id }))}
            popupClassName={cx(styles.popup)}
            suffixIcon={isProviderConfigUpdating && <Icon spin icon={Loader2Icon} />}
            value={checkModel}
            optionRender={({ value }) => {
              return (
                <Flexbox horizontal align={'center'} gap={6}>
                  <ModelIcon model={value as string} size={20} />
                  {value}
                </Flexbox>
              );
            }}
            style={{
              flex: 1,
              overflow: 'hidden',
            }}
            onSelect={async (value) => {
              // Update local state
              setCheckModel(value);
              setPass(false);
              setError(undefined);

              // Persist the selected model to provider config
              // This allows the model to be retained after page refresh
              await updateAiProviderConfig(provider, { checkModel: value });
            }}
          />
          <Button
            disabled={isProviderConfigUpdating}
            loading={loading}
            icon={
              pass ? (
                <CheckCircleFilled
                  style={{
                    color: cssVar.colorSuccess,
                  }}
                />
              ) : undefined
            }
            style={
              pass
                ? {
                    borderColor: cssVar.colorSuccess,
                    color: cssVar.colorSuccess,
                  }
                : undefined
            }
            onClick={async () => {
              await onBeforeCheck();
              try {
                await checkConnection();
              } finally {
                await onAfterCheck();
              }
            }}
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
