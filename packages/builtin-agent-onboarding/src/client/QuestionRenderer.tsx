'use client';

import type {
  UserAgentOnboardingQuestion,
  UserAgentOnboardingQuestionChoice,
  UserAgentOnboardingQuestionField,
} from '@lobechat/types';
import { Button, Flexbox, Input, Select, Text } from '@lobehub/ui';
import { Input as AntdInput } from 'antd';
import type { ChangeEvent, ReactNode } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';

type FormValue = string | string[];

export interface DefaultModelConfig {
  model?: string;
  provider?: string;
}

export interface QuestionRendererRenderEmojiPickerProps {
  onChange: (emoji?: string) => void;
  value?: string;
}

export interface QuestionRendererRenderModelSelectProps {
  onChange: (value: { model: string; provider: string }) => void;
  value?: DefaultModelConfig;
}

export interface QuestionRendererProps {
  currentQuestion: UserAgentOnboardingQuestion;
  currentResponseLanguage?: string;
  defaultModelConfig?: DefaultModelConfig;
  enableKlavis?: boolean;
  fixedModelLabel?: ReactNode;
  isDev?: boolean;
  loading?: boolean;
  nextLabel?: ReactNode;
  onBeforeInfoContinue?: (question: UserAgentOnboardingQuestion) => Promise<void> | void;
  onChangeDefaultModel?: (model: string, provider: string) => void;
  onChangeResponseLanguage?: (value: string) => void;
  onSendMessage: (message: string) => Promise<void>;
  renderEmojiPicker?: (props: QuestionRendererRenderEmojiPickerProps) => ReactNode;
  renderKlavisList?: () => ReactNode;
  renderModelSelect?: (props: QuestionRendererRenderModelSelectProps) => ReactNode;
  responseLanguageOptions?: Array<{ label: string; value: string }>;
  submitLabel?: ReactNode;
}

const getChoiceMessage = (choice: UserAgentOnboardingQuestionChoice) => {
  if (choice.payload?.kind === 'message') {
    return choice.payload.message || choice.label || undefined;
  }

  if (choice.label) {
    return choice.label;
  }

  return undefined;
};

const resolveFieldAnswer = (
  field: UserAgentOnboardingQuestionField,
  value: FormValue | undefined,
) => {
  if (Array.isArray(value)) {
    const optionLabels = value
      .map((item) => field.options?.find((option) => option.value === item)?.label || item)
      .filter(Boolean);

    return optionLabels.length > 0 ? optionLabels.join(', ') : undefined;
  }

  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) return undefined;

  return (
    field.options?.find((option) => option.value === normalizedValue)?.label || normalizedValue
  );
};

const buildQuestionAnswerMessage = (
  fields: UserAgentOnboardingQuestionField[] | undefined,
  values: Record<string, FormValue>,
) => {
  const lines =
    fields
      ?.map((field) => {
        const answer = resolveFieldAnswer(field, values[field.key]);

        if (!answer) return undefined;

        return `Q: ${field.label}\nA: ${answer}`;
      })
      .filter((line): line is string => Boolean(line)) || [];

  return lines.length > 0 ? lines.join('\n\n') : undefined;
};

const renderFieldControl = ({
  field,
  onChange,
  onSubmit,
  renderEmojiPicker,
  value,
}: {
  field: UserAgentOnboardingQuestionField;
  onChange: (nextValue: FormValue) => void;
  onSubmit?: () => void;
  renderEmojiPicker?: (props: QuestionRendererRenderEmojiPickerProps) => ReactNode;
  value: FormValue;
}) => {
  switch (field.kind) {
    case 'emoji': {
      if (renderEmojiPicker) {
        return renderEmojiPicker({
          onChange: (emoji) => onChange(emoji || ''),
          value: typeof value === 'string' ? value || undefined : undefined,
        });
      }

      return (
        <Input
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }
    case 'multiselect': {
      return (
        <Select
          mode={'multiple'}
          options={field.options}
          placeholder={field.placeholder}
          value={Array.isArray(value) ? value : []}
          onChange={(nextValue) => onChange(nextValue)}
        />
      );
    }
    case 'select': {
      return (
        <Select
          options={field.options}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : undefined}
          onChange={(nextValue) => onChange(nextValue)}
        />
      );
    }
    case 'textarea': {
      return (
        <AntdInput.TextArea
          placeholder={field.placeholder}
          rows={3}
          value={typeof value === 'string' ? value : ''}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        />
      );
    }
    case 'text': {
      return (
        <Input
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;

            event.preventDefault();
            onSubmit?.();
          }}
        />
      );
    }
  }
};

const QuestionHeader = memo<Pick<UserAgentOnboardingQuestion, 'description' | 'prompt'>>(
  ({ description, prompt }) => {
    if (!prompt && !description) return null;

    return (
      <Flexbox gap={4}>
        {prompt && <Text weight={'bold'}>{prompt}</Text>}
        {description && <Text type={'secondary'}>{description}</Text>}
      </Flexbox>
    );
  },
);

QuestionHeader.displayName = 'QuestionHeader';

const QuestionChoices = memo<{
  loading: boolean;
  onChoose: (choice: UserAgentOnboardingQuestionChoice) => Promise<void>;
  question: UserAgentOnboardingQuestion;
}>(({ loading, onChoose, question }) => (
  <Flexbox gap={12}>
    <QuestionHeader description={question.description} prompt={question.prompt} />
    <Flexbox horizontal gap={8} wrap={'wrap'}>
      {(question.choices || []).map((choice) => (
        <Button
          danger={choice.style === 'danger'}
          disabled={loading}
          key={choice.id}
          type={choice.style === 'primary' ? 'primary' : 'default'}
          onClick={() => void onChoose(choice)}
        >
          {choice.label}
        </Button>
      ))}
    </Flexbox>
  </Flexbox>
));

QuestionChoices.displayName = 'QuestionChoices';

const QuestionForm = memo<{
  loading: boolean;
  onSendMessage: (message: string) => Promise<void>;
  question: UserAgentOnboardingQuestion;
  renderEmojiPicker?: (props: QuestionRendererRenderEmojiPickerProps) => ReactNode;
  submitLabel: ReactNode;
}>(({ loading, onSendMessage, question, renderEmojiPicker, submitLabel }) => {
  const initialValues = useMemo(
    () =>
      Object.fromEntries(
        (question.fields || []).map((field) => [
          field.key,
          field.value ?? (field.kind === 'multiselect' ? [] : ''),
        ]),
      ) as Record<string, FormValue>,
    [question.fields],
  );
  const [values, setValues] = useState<Record<string, FormValue>>(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const handleSubmit = async () => {
    const message = buildQuestionAnswerMessage(question.fields, values);

    if (!message) return;

    await onSendMessage(message);
  };

  return (
    <Flexbox gap={12}>
      <QuestionHeader description={question.description} prompt={question.prompt} />
      {(question.fields || []).map((field) => (
        <Flexbox gap={6} key={field.key}>
          <Text type={'secondary'}>{field.label}</Text>
          {renderFieldControl({
            field,
            onChange: (nextValue) => setValues((state) => ({ ...state, [field.key]: nextValue })),
            onSubmit: () => void handleSubmit(),
            renderEmojiPicker,
            value: values[field.key] ?? '',
          })}
        </Flexbox>
      ))}
      <Button disabled={loading} type={'primary'} onClick={() => void handleSubmit()}>
        {submitLabel}
      </Button>
    </Flexbox>
  );
});

QuestionForm.displayName = 'QuestionForm';

const QuestionSelect = memo<{
  currentResponseLanguage?: string;
  loading: boolean;
  nextLabel: ReactNode;
  onChangeResponseLanguage?: (value: string) => void;
  onSendMessage: (message: string) => Promise<void>;
  options?: Array<{ label: string; value: string }>;
  question: UserAgentOnboardingQuestion;
}>(
  ({
    currentResponseLanguage,
    loading,
    nextLabel,
    onChangeResponseLanguage,
    onSendMessage,
    options,
    question,
  }) => {
    const isLanguageNode = question.node === 'responseLanguage';
    const field = question.fields?.[0];
    const initialValue =
      (typeof field?.value === 'string' && field.value) ||
      (isLanguageNode ? currentResponseLanguage : undefined);
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
      setValue(initialValue);
    }, [initialValue]);

    const resolvedOptions = field?.options || (isLanguageNode ? options : undefined) || [];

    const handleSubmit = async () => {
      const message = buildQuestionAnswerMessage(
        field ? [{ ...field, options: resolvedOptions }] : undefined,
        { [field?.key || 'responseLanguage']: value || '' },
      );

      if (!message) return;

      await onSendMessage(message);
    };

    return (
      <Flexbox gap={12}>
        <QuestionHeader description={question.description} prompt={question.prompt} />
        <Select
          options={resolvedOptions}
          size={'large'}
          style={{ width: '100%' }}
          value={value}
          onChange={(nextValue) => {
            if (isLanguageNode) onChangeResponseLanguage?.(nextValue);
            setValue(nextValue);
          }}
        />
        <Button disabled={loading} type={'primary'} onClick={() => void handleSubmit()}>
          {nextLabel}
        </Button>
      </Flexbox>
    );
  },
);

QuestionSelect.displayName = 'QuestionSelect';

const QuestionInfo = memo<{
  defaultModelConfig?: DefaultModelConfig;
  enableKlavis?: boolean;
  fixedModelLabel?: ReactNode;
  isDev?: boolean;
  loading: boolean;
  nextLabel: ReactNode;
  onBeforeInfoContinue?: (question: UserAgentOnboardingQuestion) => Promise<void> | void;
  onChangeDefaultModel?: (model: string, provider: string) => void;
  onSendMessage: (message: string) => Promise<void>;
  question: UserAgentOnboardingQuestion;
  renderKlavisList?: () => ReactNode;
  renderModelSelect?: (props: QuestionRendererRenderModelSelectProps) => ReactNode;
}>(
  ({
    defaultModelConfig,
    enableKlavis,
    fixedModelLabel,
    isDev,
    loading,
    nextLabel,
    onBeforeInfoContinue,
    onChangeDefaultModel,
    onSendMessage,
    question,
    renderKlavisList,
    renderModelSelect,
  }) => {
    if (question.metadata?.recommendedSurface !== 'modelPicker') {
      return (
        <Flexbox gap={8}>
          <QuestionHeader description={question.description} prompt={question.prompt} />
        </Flexbox>
      );
    }

    const handleContinue = async () => {
      await onBeforeInfoContinue?.(question);

      const message =
        defaultModelConfig?.model && defaultModelConfig.provider
          ? `I am done with advanced setup. Keep my default model as ${defaultModelConfig.provider}/${defaultModelConfig.model}.`
          : 'I am done with advanced setup.';

      await onSendMessage(message);
    };

    return (
      <Flexbox gap={16}>
        <QuestionHeader description={question.description} prompt={question.prompt} />
        {isDev && renderModelSelect ? (
          renderModelSelect({
            onChange: ({ model, provider }) => {
              onChangeDefaultModel?.(model, provider);
            },
            value: defaultModelConfig,
          })
        ) : (
          <Text type={'secondary'}>{fixedModelLabel}</Text>
        )}
        {enableKlavis && renderKlavisList?.()}
        <Button disabled={loading} type={'primary'} onClick={() => void handleContinue()}>
          {nextLabel}
        </Button>
      </Flexbox>
    );
  },
);

QuestionInfo.displayName = 'QuestionInfo';

const QuestionComposerPrefill = memo<{ question: UserAgentOnboardingQuestion }>(({ question }) => (
  <Flexbox gap={8}>
    <QuestionHeader description={question.description} prompt={question.prompt} />
  </Flexbox>
));

QuestionComposerPrefill.displayName = 'QuestionComposerPrefill';

const QuestionRenderer = memo<QuestionRendererProps>(
  ({
    currentQuestion,
    currentResponseLanguage,
    defaultModelConfig,
    enableKlavis = false,
    fixedModelLabel,
    isDev = false,
    loading = false,
    nextLabel = 'Next',
    onBeforeInfoContinue,
    onChangeDefaultModel,
    onChangeResponseLanguage,
    onSendMessage,
    renderEmojiPicker,
    renderKlavisList,
    renderModelSelect,
    responseLanguageOptions,
    submitLabel = 'Submit',
  }) => {
    const handleChoice = async (choice: UserAgentOnboardingQuestionChoice) => {
      const message = getChoiceMessage(choice);

      if (!message) return;

      await onSendMessage(message);
    };

    return (
      <Flexbox gap={16}>
        {currentQuestion.mode === 'button_group' && (
          <QuestionChoices loading={loading} question={currentQuestion} onChoose={handleChoice} />
        )}
        {currentQuestion.mode === 'form' && (
          <QuestionForm
            loading={loading}
            question={currentQuestion}
            renderEmojiPicker={renderEmojiPicker}
            submitLabel={submitLabel}
            onSendMessage={onSendMessage}
          />
        )}
        {currentQuestion.mode === 'select' && (
          <QuestionSelect
            currentResponseLanguage={currentResponseLanguage}
            loading={loading}
            nextLabel={nextLabel}
            options={responseLanguageOptions}
            question={currentQuestion}
            onChangeResponseLanguage={onChangeResponseLanguage}
            onSendMessage={onSendMessage}
          />
        )}
        {currentQuestion.mode === 'info' && (
          <QuestionInfo
            defaultModelConfig={defaultModelConfig}
            enableKlavis={enableKlavis}
            fixedModelLabel={fixedModelLabel}
            isDev={isDev}
            loading={loading}
            nextLabel={nextLabel}
            question={currentQuestion}
            renderKlavisList={renderKlavisList}
            renderModelSelect={renderModelSelect}
            onBeforeInfoContinue={onBeforeInfoContinue}
            onChangeDefaultModel={onChangeDefaultModel}
            onSendMessage={onSendMessage}
          />
        )}
        {currentQuestion.mode === 'composer_prefill' && (
          <QuestionComposerPrefill question={currentQuestion} />
        )}
      </Flexbox>
    );
  },
);

QuestionRenderer.displayName = 'QuestionRenderer';

export default QuestionRenderer;
