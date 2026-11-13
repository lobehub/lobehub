'use client';

import { ActionIcon, Block, Button, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { CopyIcon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AsyncTaskErrorType } from '@/types/asyncTask';
import type { Generation } from '@/types/generation';
import { getRuntimeErrorMessage } from '@/utils/locale/runtimeErrorMessage';

interface MusicErrorItemProps {
  generation: Generation;
  isRetrying?: boolean;
  onCopyError: () => void;
  onDelete: () => void;
  onRetry: () => void;
}

const MusicErrorItem = memo<MusicErrorItemProps>(
  ({ generation, isRetrying, onCopyError, onDelete, onRetry }) => {
    const { t } = useTranslation('music');
    const { t: tError } = useTranslation(['error', 'modelRuntime']);

    const errorMessage = useMemo(() => {
      const error = generation.task.error;
      if (!error) return '';

      const errorBody = typeof error.body === 'string' ? error.body : error.body?.detail;
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
          <Text strong>
            {isModeration
              ? tError('response.ProviderContentModeration')
              : t('generation.status.failed')}
          </Text>
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
