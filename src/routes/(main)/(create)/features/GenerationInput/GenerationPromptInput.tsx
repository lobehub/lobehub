'use client';

import { ChatInput, ChatInputActionBar, SendButton } from '@lobehub/editor/react';
import { createStaticStyles, Flexbox, TextArea } from '@lobehub/ui';
import type { KeyboardEvent, ReactNode } from 'react';
import { memo } from 'react';

interface GenerationPromptInputProps {
  /** Extra inputs rendered under the prompt, inside the input box */
  bottomContent?: ReactNode;
  /**
   * Whether the draft can be submitted. Defaults to a non-empty prompt; pages whose other
   * inputs can stand in for the prompt (music lyrics or style) pass their own check.
   */
  canSubmit?: boolean;
  centerActions?: ReactNode;
  className?: string;
  disabled?: boolean;
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

const styles = createStaticStyles(({ css }) => ({
  textarea: css`
    padding: 0;
    border-radius: 0;
  `,
}));

const GenerationPromptInput = memo<GenerationPromptInputProps>(
  ({
    bottomContent,
    canSubmit,
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
    disabled,
    minRows = 3,
    maxRows = 6,
  }) => {
    // Enter ignores a whitespace-only prompt; the button keeps its original non-empty check
    const hasInput = canSubmit ?? !!value?.trim();
    const canClickGenerate = canSubmit ?? !!value;

    const handleKeyDown = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;

      e.preventDefault();
      if (disabled || disableGenerate || isCreating || !hasInput) return;

      await onGenerate();
    };

    const textarea = (
      <TextArea
        autoSize={{ maxRows, minRows }}
        className={styles.textarea}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        variant={'borderless'}
        onKeyDown={handleKeyDown}
        onChange={(e) => {
          if (disabled) return;

          onValueChange(e.target.value);
        }}
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
                  disabled={disabled || disableGenerate || !canClickGenerate}
                  loading={isCreating}
                  title={isCreating ? generatingLabel : generateLabel}
                  onClick={() => {
                    if (disabled) return;

                    onGenerate();
                  }}
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
                    disabled={disabled || disableGenerate || !canClickGenerate}
                    loading={isCreating}
                    title={isCreating ? generatingLabel : generateLabel}
                    onClick={() => {
                      if (disabled) return;

                      onGenerate();
                    }}
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
        {bottomContent}
      </ChatInput>
    );
  },
);

GenerationPromptInput.displayName = 'GenerationPromptInput';

export default GenerationPromptInput;
