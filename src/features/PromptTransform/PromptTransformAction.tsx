'use client';

import { Languages, Lightbulb, Sparkles } from 'lucide-react';
import { memo, useMemo } from 'react';
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

    const menuItems = useMemo(
      () => [
        {
          icon: <Sparkles size={16} />,
          key: 'rewrite',
          label: t('promptTransform.actions.rewrite'),
          onClick: rewritePrompt,
        },
        {
          icon: <Languages size={16} />,
          key: 'translate',
          label: t('promptTransform.actions.translate'),
          onClick: translatePrompt,
        },
      ],
      [rewritePrompt, t, translatePrompt],
    );

    const handlePrimaryAction = useMemo(
      () => (isRewriteEnabled ? rewritePrompt : translatePrompt),
      [isRewriteEnabled, rewritePrompt, translatePrompt],
    );

    const dropdown = useMemo(() => {
      if (!isRewriteEnabled) return undefined;

      return {
        menu: { items: menuItems },
        trigger: 'hover' as const,
      };
    }, [isRewriteEnabled, menuItems]);

    const primaryIcon = isRewriteEnabled ? Lightbulb : Languages;
    const isActionDisabled = isTransformDisabled || isTransforming;

    return (
      <Action
        disabled={isActionDisabled}
        dropdown={dropdown}
        icon={primaryIcon}
        loading={isTransforming}
        title={
          isTransforming
            ? t(
                transformAction === 'translate'
                  ? 'promptTransform.status.translate'
                  : 'promptTransform.status.rewrite',
              )
            : t(isRewriteEnabled ? 'promptTransform.action' : 'promptTransform.actions.translate')
        }
        onClick={handlePrimaryAction}
      />
    );
  },
);

PromptTransformAction.displayName = 'PromptTransformAction';

export default PromptTransformAction;
