'use client';

import { ActionIcon, Block, Button, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { CopyIcon, KeyRoundIcon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProviderName } from '@/hooks/useProviderName';
import { AsyncTaskErrorType } from '@/types/asyncTask';
import type { Generation } from '@/types/generation';
import { getRuntimeErrorMessage } from '@/utils/locale/runtimeErrorMessage';

interface MusicErrorItemProps {
  generation: Generation;
  isRetrying?: boolean;
  onCopyError: () => void;
  onDelete: () => void;
  onRetry: () => void;
  provider?: string;
}

const MusicErrorItem = memo<MusicErrorItemProps>(
  ({ generation, isRetrying, onCopyError, onDelete, onRetry, provider }) => {
    const { t } = useTranslation('music');
    const { t: tError } = useTranslation(['error', 'modelRuntime']);
    const navigate = useWorkspaceAwareNavigate();
    const providerName = useProviderName(provider ?? '');

    const errorMessage = useMemo(() => {
      const error = generation.task.error;
      if (!error) return '';

      const errorBody = typeof error.body === 'string' ? error.body : error.body?.detail;
      // A bare error name adds nothing to the localized invalid-key message
      if (error.name === AsyncTaskErrorType.InvalidProviderAPIKey && errorBody === error.name) {
        return '';
      }
      if (errorBody) {
        const translated = getRuntimeErrorMessage(tError, errorBody);
        if (
          translated &&
          translated !== `modelRuntime:${errorBody}` &&
          translated !== `response.${errorBody}`
        ) {
          return translated;
        }
        return errorBody;
      }

      return error.name || '';
    }, [generation.task.error, tError]);

    const isModeration =
      generation.task.error?.name === AsyncTaskErrorType.ProviderContentModeration;
    // A rejected key fails the song like any other error, so it keeps the card and its retry;
    // the card also explains the cause and links to the provider settings.
    const isInvalidApiKey =
      generation.task.error?.name === AsyncTaskErrorType.InvalidProviderAPIKey;

    const title = isModeration
      ? tError('response.ProviderContentModeration')
      : isInvalidApiKey
        ? t('generation.status.invalidApiKey', { name: providerName || provider || '' })
        : t('generation.status.failed');

    return (
      <Block
        horizontal
        align={'center'}
        data-music-status={'error'}
        gap={12}
        padding={12}
        variant={'filled'}
      >
        <Flexbox
          align={'center'}
          justify={'center'}
          style={{ flex: 'none', height: 48, width: 48 }}
        >
          <Icon color={cssVar.colorError} icon={TriangleAlertIcon} size={24} />
        </Flexbox>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text strong>{title}</Text>
          {isInvalidApiKey && (
            <Text fontSize={12} type={'secondary'}>
              {t('generation.status.invalidApiKeyHint')}
            </Text>
          )}
          {errorMessage && !isModeration && (
            <Text
              ellipsis={{ rows: 2 }}
              fontSize={12}
              style={{ wordBreak: 'break-all' }}
              title={errorMessage}
              type={'secondary'}
            >
              {errorMessage}
            </Text>
          )}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={4} style={{ flex: 'none' }}>
          {isInvalidApiKey && (
            <Button
              icon={KeyRoundIcon}
              size={'small'}
              onClick={() => navigate(urlJoin('/settings/provider', provider || 'all'))}
            >
              {t('generation.actions.openProviderSettings')}
            </Button>
          )}
          <Button icon={RotateCcwIcon} loading={isRetrying} size={'small'} onClick={onRetry}>
            {t('generation.actions.retry')}
          </Button>
          {errorMessage && (
            <ActionIcon
              icon={CopyIcon}
              size={'small'}
              title={t('generation.actions.copyError')}
              onClick={onCopyError}
            />
          )}
          <ActionIcon
            icon={Trash2Icon}
            size={'small'}
            title={t('generation.actions.delete')}
            onClick={onDelete}
          />
        </Flexbox>
      </Block>
    );
  },
);

MusicErrorItem.displayName = 'MusicErrorItem';

export default MusicErrorItem;
