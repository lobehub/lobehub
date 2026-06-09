'use client';

import { Block, Center, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { VideoOffIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionButtons } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/ActionButtons';
import { styles } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/styles';
import { AsyncTaskErrorType } from '@/types/asyncTask';
import type { Generation } from '@/types/generation';
import { getRuntimeErrorMessage } from '@/utils/locale/runtimeErrorMessage';

interface VideoErrorItemProps {
  aspectRatio?: string;
  generation: Generation;
  onCopyError: () => void;
  onDelete: () => void;
}

const VideoErrorItem = memo<VideoErrorItemProps>(
  ({ generation, aspectRatio, onDelete, onCopyError }) => {
    const { t } = useTranslation('video');
    const { t: tError } = useTranslation(['error', 'modelRuntime']);

    const errorMessage = useMemo(() => {
      if (!generation.task.error) return '';

      const error = generation.task.error;
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

      return error.name || 'Unknown error';
    }, [generation.task.error, tError]);

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
          aspectRatio: aspectRatio?.includes(':') ? aspectRatio.replace(':', '/') : '16/9',
          cursor: 'pointer',
          maxHeight: '50vh',
          width: '100%',
        }}
        onClick={onCopyError}
      >
        <Center gap={8}>
          <Icon color={cssVar.colorTextDescription} icon={VideoOffIcon} size={24} />
          <Text strong type={'secondary'}>
            {isProviderContentModerationError
              ? tError('response.ProviderContentModeration')
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

VideoErrorItem.displayName = 'VideoErrorItem';

export default VideoErrorItem;
