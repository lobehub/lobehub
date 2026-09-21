'use client';

import { Block, Center, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ImageOffIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import defaultErrorLocale from '@/locales/default/error';
import { AsyncTaskErrorType } from '@/types/asyncTask';
import { getRuntimeErrorMessage } from '@/utils/locale/runtimeErrorMessage';

import { ActionButtons } from './ActionButtons';
import { styles } from './styles';
import { type ErrorStateProps } from './types';
import { getThumbnailMaxWidth } from './utils';

const providerContentModerationErrorKeys = [
  'response.ProviderContentModeration',
  'response.ProviderContentModerationWarning',
  'response.ProviderImageContentModerationCooldown',
  'response.ProviderImageContentModerationWarning',
] as const;

const providerContentModerationKeyByDefaultMessage = new Map<
  string,
  (typeof providerContentModerationErrorKeys)[number]
>(providerContentModerationErrorKeys.map((key) => [defaultErrorLocale[key], key]));

/** Older tasks persist this wording instead of a locale key. */
providerContentModerationKeyByDefaultMessage.set(
  'Content policy check failed. Please revise your prompt.',
  'response.ProviderContentModeration',
);

// Error state component
export const ErrorState = memo<ErrorStateProps>(
  ({ generation, generationBatch, aspectRatio, onDelete, onCopyError }) => {
    const { t } = useTranslation('image');
    const { t: tError, i18n } = useTranslation(['error', 'modelRuntime']);
    const taskError = generation.task.error;
    const retryAt = typeof taskError?.body === 'object' ? taskError.body?.retryAt : undefined;
    const retryTime = retryAt ? Date.parse(retryAt) : NaN;
    const [retryClock, setRetryClock] = useState(0);
    const cooldownExpired = retryTime <= Date.now();

    useEffect(() => {
      const remaining = retryTime - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) return;

      /** Recheck after background-tab suspension and avoid overflowing long timers. */
      const timer = setTimeout(
        () => setRetryClock((clock) => clock + 1),
        Math.min(remaining, 60_000),
      );
      return () => clearTimeout(timer);
    }, [retryTime, retryClock]);

    const errorMessage = useMemo(() => {
      if (!generation.task.error) return '';

      const error = generation.task.error;
      if (
        error.name === AsyncTaskErrorType.ProviderContentModeration &&
        Number.isFinite(retryTime)
      ) {
        if (cooldownExpired) {
          return tError('response.ProviderImageContentModerationCooldownExpired');
        }

        const time = new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        }).format(retryTime);
        return tError('response.ProviderImageContentModerationCooldownUntil', { time });
      }
      const errorBody = typeof error.body === 'string' ? error.body : error.body?.detail;
      const translateErrorKey = (translationKey: string, fallbackKey?: string) => {
        const translated = tError(translationKey as any);

        // If translation key is not found, it returns the key itself.
        if (translated !== translationKey && !(translated as string).startsWith('response.')) {
          return translated as string;
        }

        if (!fallbackKey) return;

        // Try without any prefix for backwards compatibility with legacy error details.
        const directTranslated = tError(fallbackKey as any);
        return directTranslated !== fallbackKey ? (directTranslated as string) : undefined;
      };

      // Try to translate based on error type if it matches known AgentRuntimeErrorType
      if (errorBody) {
        if (errorBody.startsWith('response.')) {
          return translateErrorKey(errorBody) || errorBody;
        }

        const defaultMessageTranslationKey =
          providerContentModerationKeyByDefaultMessage.get(errorBody);
        if (defaultMessageTranslationKey) {
          return translateErrorKey(defaultMessageTranslationKey) || errorBody;
        }

        // Try the unified ERROR_CODE_SPECS-driven lookup (routes to either the
        // new `modelRuntime` namespace or legacy `error.response.<X>`).
        const runtimeMessage = getRuntimeErrorMessage(tError, errorBody);
        if (
          runtimeMessage &&
          runtimeMessage !== `modelRuntime:${errorBody}` &&
          runtimeMessage !== `response.${errorBody}`
        ) {
          return runtimeMessage;
        }
      }

      // Fallback to original error message
      return errorBody || error.name || 'Unknown error';
    }, [
      generation.task.error,
      tError,
      i18n.resolvedLanguage,
      i18n.language,
      retryTime,
      cooldownExpired,
    ]);

    const isProviderContentModerationError =
      generation.task.error?.name === AsyncTaskErrorType.ProviderContentModeration;

    return (
      <Block
        align={'center'}
        className={styles.placeholderContainer}
        justify={'center'}
        padding={16}
        variant={'filled'}
        style={{
          aspectRatio,
          cursor: 'pointer',
          maxWidth: getThumbnailMaxWidth(generation, generationBatch),
        }}
        onClick={onCopyError}
      >
        <Center gap={8}>
          <Icon color={cssVar.colorTextDescription} icon={ImageOffIcon} size={24} />
          <Text strong align={'center'} type={'secondary'}>
            {isProviderContentModerationError
              ? errorMessage || tError('response.ProviderContentModeration')
              : t('generation.status.failed')}
          </Text>
          {generation.task.error && !isProviderContentModerationError && (
            <Text
              code
              ellipsis={{ rows: 2 }}
              fontSize={10}
              title={t('generation.actions.copyError')}
              type={'secondary'}
              style={{
                wordBreak: 'break-all',
              }}
            >
              {errorMessage}
            </Text>
          )}
        </Center>
        <ActionButtons onDelete={onDelete} />
      </Block>
    );
  },
);

ErrorState.displayName = 'ErrorState';
