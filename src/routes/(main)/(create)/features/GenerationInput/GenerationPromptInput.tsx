'use client';

import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { Button, Flexbox, TextArea } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Sparkles } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { memo } from 'react';

interface GenerationPromptInputProps {
  className?: string;
  disableGenerate?: boolean;
  generateLabel: string;
  generatingLabel: string;
  header?: ReactNode;
  inlineContent?: ReactNode;
  isCreating?: boolean;
  isDarkMode?: boolean;
  leftActions?: ReactNode;
  maxRows?: number;
  minRows?: number;
  onGenerate: () => Promise<void> | void;
  onValueChange: (value: string) => void;
  placeholder: string;
  rightActions?: ReactNode;
  value?: string;
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
  textarea: css`
    padding: 0;
    border-radius: 0;
  `,
}));

const GenerationPromptInput = memo<GenerationPromptInputProps>(
  ({
    className,
    header,
    inlineContent,
    leftActions,
    rightActions,
    isDarkMode,
    isCreating,
    value,
    onValueChange,
    onGenerate,
    placeholder,
    generateLabel,
    generatingLabel,
    disableGenerate,
    minRows = 3,
    maxRows = 6,
  }) => {
    const handleKeyDown = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;

      e.preventDefault();
      if (disableGenerate || isCreating || !value?.trim()) return;

      await onGenerate();
    };

    const textarea = (
      <TextArea
        autoSize={{ maxRows, minRows }}
        className={styles.textarea}
        placeholder={placeholder}
        value={value}
        variant={'borderless'}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    );

    return (
      <ChatInput
        className={cx(styles.container, isDarkMode && styles.container_dark, className)}
        header={header}
        styles={{ body: { padding: 8 } }}
        footer={
          <ChatInputActionBar
            left={leftActions}
            right={
              <Flexbox horizontal align={'center'} gap={8}>
                {rightActions}
                <Button
                  disabled={disableGenerate || !value}
                  icon={Sparkles}
                  loading={isCreating}
                  size={'large'}
                  title={isCreating ? generatingLabel : generateLabel}
                  type={'primary'}
                  style={{
                    fontWeight: 500,
                    height: 48,
                    minWidth: 48,
                    width: 48,
                  }}
                  onClick={onGenerate}
                />
              </Flexbox>
            }
          />
        }
      >
        {inlineContent ? (
          <Flexbox horizontal align={'start'} gap={8}>
            {inlineContent}
            <Flexbox flex={1}>{textarea}</Flexbox>
          </Flexbox>
        ) : (
          textarea
        )}
      </ChatInput>
    );
  },
);

GenerationPromptInput.displayName = 'GenerationPromptInput';

export default GenerationPromptInput;
