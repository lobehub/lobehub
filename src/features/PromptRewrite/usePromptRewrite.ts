import { chainRewriteGenerationPrompt, chainTranslate } from '@lobechat/prompts';
import { useCallback, useState } from 'react';

import { chatService } from '@/services/chat';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';
import { merge } from '@/utils/merge';

interface UsePromptRewriteParams {
  mode: 'image' | 'video' | 'text';
  onPromptChange: (prompt: string) => void;
  prompt?: string | null;
}

type PromptTransformAction = 'rewrite' | 'translate';

export const usePromptRewrite = ({ mode, prompt, onPromptChange }: UsePromptRewriteParams) => {
  const [isRewriting, setIsRewriting] = useState(false);
  const [transformAction, setTransformAction] = useState<PromptTransformAction>('rewrite');

  const rewriteConfig = useUserStore(systemAgentSelectors.promptRewrite);
  const locale = useUserStore(userGeneralSettingsSelectors.currentResponseLanguage);
  const isEnabled = rewriteConfig?.enabled ?? false;

  const runTransform = useCallback(
    async (action: PromptTransformAction) => {
      if (!prompt?.trim() || !isEnabled) return;

      let rewrittenPrompt = '';
      setTransformAction(action);

      try {
        await chatService.fetchPresetTaskResult({
          onError: () => {
            setIsRewriting(false);
          },
          onFinish: async (text) => {
            const nextPrompt = text.trim() || rewrittenPrompt.trim();
            if (nextPrompt) onPromptChange(nextPrompt);
          },
          onLoadingChange: setIsRewriting,
          onMessageHandle: (chunk) => {
            if (chunk.type === 'text') rewrittenPrompt += chunk.text;
          },
          params: merge(
            rewriteConfig ?? {},
            action === 'rewrite'
              ? chainRewriteGenerationPrompt({
                  locale,
                  mode,
                  prompt,
                })
              : chainTranslate(prompt, 'English'),
          ),
        });
      } finally {
        setIsRewriting(false);
        setTransformAction('rewrite');
      }
    },
    [isEnabled, locale, mode, onPromptChange, prompt, rewriteConfig],
  );

  const rewritePrompt = useCallback(async () => {
    await runTransform('rewrite');
  }, [runTransform]);

  const translatePrompt = useCallback(async () => {
    await runTransform('translate');
  }, [runTransform]);

  return {
    isRewriteDisabled: !isEnabled || !prompt?.trim(),
    isRewriting,
    transformAction,
    translatePrompt,
    rewritePrompt,
  };
};
