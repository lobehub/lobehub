'use client';

import { Sparkles } from 'lucide-react';
import { memo, useMemo } from 'react';
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
      isTranslateActionEnabled,
      rewritePrompt,
      translatePrompt,
      transformAction,
    } = usePromptRewrite({
      mode,
      onPromptChange,
      prompt,
    });

    const menuItems = useMemo(
      () => [
        {
          disabled: !isRewriteActionEnabled,
          key: 'rewrite',
          label: t('promptTransform.actions.rewrite'),
          onClick: rewritePrompt,
        },
        {
          disabled: !isTranslateActionEnabled,
          key: 'translate',
          label: t('promptTransform.actions.translate'),
          onClick: translatePrompt,
        },
      ],
      [isRewriteActionEnabled, isTranslateActionEnabled, rewritePrompt, t, translatePrompt],
    );

    const handlePrimaryAction = useMemo(() => {
      if (isRewriteActionEnabled) return rewritePrompt;
      if (isTranslateActionEnabled) return translatePrompt;

      return undefined;
    }, [isRewriteActionEnabled, isTranslateActionEnabled, rewritePrompt, translatePrompt]);

    return (
      <Action
        disabled={isRewriteDisabled}
        icon={Sparkles}
        loading={isRewriting}
        dropdown={{
          menu: { items: menuItems },
          trigger: 'hover',
        }}
        title={
          isRewriting
            ? t(
                transformAction === 'translate'
                  ? 'promptTransform.status.translate'
                  : 'promptTransform.status.rewrite',
              )
            : t('promptTransform.action')
        }
        onClick={handlePrimaryAction}
      />
    );
  },
);

PromptTransformAction.displayName = 'PromptTransformAction';

export default PromptTransformAction;
