'use client';

import { Block, Icon, Text } from '@lobehub/ui';
import { ImageOffIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Center } from 'react-layout-kit';

import { AgentRuntimeErrorType } from '@lobechat/model-runtime';

import { ActionButtons } from './ActionButtons';
import { useStyles } from './styles';
import { ErrorStateProps } from './types';
import { getThumbnailMaxWidth } from './utils';

// 错误状态组件
export const ErrorState = memo<ErrorStateProps>(
  ({ generation, generationBatch, aspectRatio, onDelete, onCopyError }) => {
    const { styles, theme } = useStyles();
    const { t } = useTranslation('image');
    const { t: tError } = useTranslation('error');

    const errorMessage = useMemo(() => {
      if (!generation.task.error) return '';

      const error = generation.task.error;
      const errorBody = typeof error.body === 'string' ? error.body : error.body?.detail;

      // Try to translate based on error type if it matches known AgentRuntimeErrorType
      if (errorBody) {
        // Check if the error body is an AgentRuntimeErrorType that needs translation
        const knownErrorTypes = Object.values(AgentRuntimeErrorType);
        if (
          knownErrorTypes.includes(
            errorBody as (typeof AgentRuntimeErrorType)[keyof typeof AgentRuntimeErrorType],
          )
        ) {
          // Use localized error message - ComfyUI errors are under 'response' namespace
          const translationKey = `response.${errorBody}`;
          const translated = tError(translationKey as any);

          // If translation key is not found, it returns the key itself
          // Check if we got back the key (meaning translation failed)
          if (translated === translationKey || (translated as string).startsWith('response.')) {
            // Try without any prefix (for backwards compatibility)
            const directTranslated = tError(errorBody as any);
            if (directTranslated !== errorBody) {
              return directTranslated as string;
            }
            // Final fallback to the original error message
            return errorBody;
          }

          return translated as string;
        }
      }

      // Fallback to original error message
      return errorBody || error.name || 'Unknown error';
    }, [generation.task.error, generationBatch.provider, tError]);

    return (
      <Block
        align={'center'}
        className={styles.placeholderContainer}
        justify={'center'}
        onClick={onCopyError}
        padding={16}
        style={{
          aspectRatio,
          cursor: 'pointer',
          maxWidth: getThumbnailMaxWidth(generation, generationBatch),
        }}
        variant={'filled'}
      >
        <Center gap={8}>
          <Icon color={theme.colorTextDescription} icon={ImageOffIcon} size={24} />
          <Text strong type={'secondary'}>
            {t('generation.status.failed')}
          </Text>
          {generation.task.error && (
            <Text
              code
              ellipsis={{ rows: 2 }}
              fontSize={10}
              style={{
                wordBreak: 'break-all',
              }}
              title={t('generation.actions.copyError')}
              type={'secondary'}
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
