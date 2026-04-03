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
          key: 'rewrite',
          label: t('promptTransform.actions.rewrite'),
          onClick: rewritePrompt,
        },
        {
          key: 'translate',
          label: t('promptTransform.actions.translate'),
          onClick: translatePrompt,
        },
      ],
      [rewritePrompt, t, translatePrompt],
    );

    const handlePrimaryAction = useMemo(
      () => (isRewriteActionEnabled ? rewritePrompt : translatePrompt),
      [isRewriteActionEnabled, rewritePrompt, translatePrompt],
    );

    const dropdown = useMemo(() => {
      if (!isRewriteActionEnabled) return undefined;

      return {
        menu: { items: menuItems },
        trigger: 'hover' as const,
      };
    }, [isRewriteActionEnabled, menuItems]);

    return (
      <Action
        disabled={isRewriteDisabled}
        dropdown={dropdown}
        icon={Sparkles}
        loading={isRewriting}
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
