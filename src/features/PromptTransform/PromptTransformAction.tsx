'use client';

import { Flexbox } from '@lobehub/ui';
import { Languages, Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Action from '@/features/ChatInput/ActionBar/components/Action';

import { usePromptTransform } from './usePromptTransform';

interface PromptTransformActionProps {
  mode: 'image' | 'video' | 'text';
  onPromptChange: (prompt: string) => void;
  prompt?: string | null;
}

const PromptTransformAction = memo<PromptTransformActionProps>(
  ({ mode, onPromptChange, prompt }) => {
    const { t } = useTranslation('common');

    const {
      isTransformDisabled,
      isTransforming,
      transformAction,
      isRewriteEnabled,
      rewritePrompt,
      translatePrompt,
    } = usePromptTransform({
      mode,
      onPromptChange,
      prompt,
    });

    const isRewriteLoading = isTransforming && transformAction === 'rewrite';
    const isTranslateLoading = isTransforming && transformAction === 'translate';

    // Disable all transform buttons while one action is running
    const isActionDisabled = isTransformDisabled || isTransforming;

    return (
      <Flexbox horizontal gap={4}>
        {isRewriteEnabled && (
          <Action
            disabled={isActionDisabled}
            icon={Sparkles}
            loading={isRewriteLoading}
            title={
              isRewriteLoading
                ? t('promptTransform.status.rewrite')
                : t('promptTransform.actions.rewrite')
            }
            onClick={rewritePrompt}
          />
        )}
        <Action
          disabled={isActionDisabled}
          icon={Languages}
          loading={isTranslateLoading}
          title={
            isTranslateLoading
              ? t('promptTransform.status.translate')
              : t('promptTransform.actions.translate')
          }
          onClick={translatePrompt}
        />
      </Flexbox>
    );
  },
);

PromptTransformAction.displayName = 'PromptTransformAction';

export default PromptTransformAction;
