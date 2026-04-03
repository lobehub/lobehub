'use client';

import { Flexbox } from '@lobehub/ui';
import { Languages, Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Action from '@/features/ChatInput/ActionBar/components/Action';

import { usePromptRewrite } from './usePromptRewrite';

interface PromptTransformActionProps {
  mode: 'image' | 'video' | 'text';
  onPromptChange: (prompt: string) => void;
  prompt?: string | null;
}

const PromptTransformAction = memo<PromptTransformActionProps>(
  ({ mode, onPromptChange, prompt }) => {
    const { t } = useTranslation('common');

    const {
      isRewriteDisabled,
      isRewriteActionEnabled,
      isRewriting,
      rewritePrompt,
      translatePrompt,
      transformAction,
    } = usePromptRewrite({
      mode,
      onPromptChange,
      prompt,
    });

    const isRewriteLoading = isRewriting && transformAction === 'rewrite';
    const isTranslateLoading = isRewriting && transformAction === 'translate';

    // When rewriting or translating, disable both buttons to prevent multiple simultaneous actions
    const isRewriteButtonDisabled = isRewriteDisabled || (isRewriting && !isRewriteLoading);
    const isTranslateButtonDisabled = isRewriteDisabled || (isRewriting && !isTranslateLoading);

    return (
      <Flexbox horizontal gap={4}>
        {isRewriteActionEnabled && (
          <Action
            disabled={isRewriteButtonDisabled}
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
          disabled={isTranslateButtonDisabled}
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
