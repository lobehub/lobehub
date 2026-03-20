'use client';

import { ChatInput, ChatInputActionBar, SendButton } from '@lobehub/editor/react';
import { Flexbox, TextArea } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { KeyboardEvent, ReactNode } from 'react';
import { memo } from 'react';

interface GenerationPromptInputProps {
  centerActions?: ReactNode;
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
  textarea: css`
    padding: 0;
    border-radius: 0;
  `,
}));

const GenerationPromptInput = memo<GenerationPromptInputProps>(
  ({
    centerActions,
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
        className={className}
        header={header}
        styles={{ body: { padding: 8 } }}
        footer={
          centerActions ? (
            <Flexbox horizontal align={'center'} gap={4} padding={4} width={'100%'}>
              <Flexbox
                horizontal
                align={'center'}
                flex={1}
                gap={4}
                style={{ justifyContent: 'flex-start', minWidth: 0 }}
              >
                {leftActions}
              </Flexbox>
              <Flexbox align={'center'} flex={1} justify={'center'} style={{ minWidth: 0 }}>
                {centerActions}
              </Flexbox>
              <Flexbox
                horizontal
                align={'center'}
                flex={1}
                gap={8}
                style={{ justifyContent: 'flex-end', minWidth: 0 }}
              >
                {rightActions}
                <SendButton
                  disabled={disableGenerate || !value}
                  loading={isCreating}
                  title={isCreating ? generatingLabel : generateLabel}
                  onClick={onGenerate}
                />
              </Flexbox>
            </Flexbox>
          ) : (
            <ChatInputActionBar
              left={leftActions}
              right={
                <Flexbox horizontal align={'center'} gap={8}>
                  {rightActions}
                  <SendButton
                    disabled={disableGenerate || !value}
                    loading={isCreating}
                    title={isCreating ? generatingLabel : generateLabel}
                    onClick={onGenerate}
                  />
                </Flexbox>
              }
            />
          )
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
