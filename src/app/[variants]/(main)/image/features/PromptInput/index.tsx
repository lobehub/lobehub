'use client';

import { ChatInput } from '@lobehub/editor/react';
import { Button, Flexbox, TextArea } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Sparkles } from 'lucide-react';
import { type KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { loginRequired } from '@/components/Error/loginRequiredNotification';
import { useGeminiChineseWarning } from '@/hooks/useGeminiChineseWarning';
import { useIsDark } from '@/hooks/useIsDark';
import { useQueryState } from '@/hooks/useQueryParam';
import { useImageStore } from '@/store/image';
import { createImageSelectors } from '@/store/image/selectors';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';
import { imageGenerationConfigSelectors } from '@/store/image/slices/generationConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import PromptTitle from './Title';

interface PromptInputProps {
  disableAnimation?: boolean;
  showTitle?: boolean;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    box-shadow:
      ${cssVar.boxShadowTertiary},
      0 0 0 ${cssVar.colorBgContainer},
      0 32px 0 ${cssVar.colorBgContainer};
  `,
  container_dark: css`
    box-shadow:
      ${cssVar.boxShadowTertiary},
      0 0 48px 32px ${cssVar.colorBgContainer},
      0 32px 0 ${cssVar.colorBgContainer};
  `,
}));

const PromptInput = ({ showTitle = false }: PromptInputProps) => {
  const isDarkMode = useIsDark();
  const { t } = useTranslation('image');
  const { value, setValue } = useGenerationConfigParam('prompt');
  const isCreating = useImageStore(createImageSelectors.isCreating);
  const createImage = useImageStore((s) => s.createImage);
  const currentModel = useImageStore(imageGenerationConfigSelectors.model);
  const isLogin = useUserStore(authSelectors.isLogin);
  const checkGeminiChineseWarning = useGeminiChineseWarning();

  // Read prompt from query parameter
  const [promptParam, setPromptParam] = useQueryState('prompt');
  const hasProcessedPrompt = useRef(false);

  const handleGenerate = async () => {
    if (!isLogin) {
      loginRequired.redirect({ timeout: 2000 });
      return;
    }
    // Check for Chinese text warning with Gemini model
    const shouldContinue = await checkGeminiChineseWarning({
      model: currentModel,
      prompt: value,
      scenario: 'image',
    });

    if (!shouldContinue) return;

    await createImage();
  };

  // Auto-fill and auto-send when prompt query parameter is present
  useEffect(() => {
    if (promptParam && !hasProcessedPrompt.current && isLogin) {
      // Decode the prompt parameter
      const decodedPrompt = decodeURIComponent(promptParam);

      // Set the prompt value in the store
      setValue(decodedPrompt);

      // Mark as processed to avoid running this effect again
      hasProcessedPrompt.current = true;

      // Clear the query parameter
      setPromptParam(null);

      // Auto-trigger generation after a short delay to ensure state is updated
      setTimeout(async () => {
        const shouldContinue = await checkGeminiChineseWarning({
          model: currentModel,
          prompt: decodedPrompt,
          scenario: 'image',
        });

        if (shouldContinue) {
          await createImage();
        }
      }, 100);
    }
  }, [
    promptParam,
    isLogin,
    setValue,
    setPromptParam,
    checkGeminiChineseWarning,
    currentModel,
    createImage,
  ]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isCreating && value.trim()) {
        handleGenerate();
      }
    }
  };

  return (
    <Flexbox gap={32} width={'100%'}>
      {showTitle && <PromptTitle />}
      <ChatInput
        className={cx(styles.container, isDarkMode && styles.container_dark)}
        styles={{ body: { padding: 8 } }}
      >
        <Flexbox horizontal align="flex-end" gap={12} height={'100%'} width={'100%'}>
          <TextArea
            autoSize={{ maxRows: 6, minRows: 3 }}
            placeholder={t('config.prompt.placeholder')}
            value={value}
            variant={'borderless'}
            style={{
              borderRadius: 0,
              padding: 0,
            }}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            disabled={!value}
            icon={Sparkles}
            loading={isCreating}
            size={'large'}
            type={'primary'}
            style={{
              fontWeight: 500,
              height: 64,
              minWidth: 64,
              width: 64,
            }}
            title={
              isCreating ? t('generation.status.generating') : t('generation.actions.generate')
            }
            onClick={handleGenerate}
          />
        </Flexbox>
      </ChatInput>
    </Flexbox>
  );
};

export default PromptInput;
