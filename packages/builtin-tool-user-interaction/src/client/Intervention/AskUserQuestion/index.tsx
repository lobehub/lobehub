'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Button, Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionArgs, InteractionField } from '../../../types';
import { styles } from './style';

const FieldInput = memo<{
  field: InteractionField;
  onChange: (key: string, value: string | string[]) => void;
  onPressEnter?: () => void;
  value?: string | string[];
}>(({ field, value, onChange, onPressEnter }) => {
  switch (field.kind) {
    case 'textarea': {
      return (
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          placeholder={field.placeholder}
          value={value as string}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
    }
    case 'select': {
      return (
        <Select
          options={field.options?.map((o) => ({ label: o.label, value: o.value }))}
          placeholder={field.placeholder}
          style={{ width: '100%' }}
          value={value as string}
          onChange={(v) => onChange(field.key, v as string)}
        />
      );
    }
    case 'multiselect': {
      return (
        <Select
          mode="multiple"
          options={field.options?.map((o) => ({ label: o.label, value: o.value }))}
          placeholder={field.placeholder}
          style={{ width: '100%' }}
          value={value as string[]}
          onChange={(v) => onChange(field.key, v as string[])}
        />
      );
    }
    default: {
      return (
        <Input
          placeholder={field.placeholder}
          value={value as string}
          onChange={(e) => onChange(field.key, e.target.value)}
          onPressEnter={onPressEnter}
        />
      );
    }
  }
});

const AskUserQuestionIntervention = memo<BuiltinInterventionProps<AskUserQuestionArgs>>(
  ({ args, interactionMode, onInteractionAction }) => {
    const { t } = useTranslation('ui');
    const { question } = args;
    const isCustom = interactionMode === 'custom';

    const initialValues: Record<string, string | string[]> = {};
    if (question.fields) {
      for (const field of question.fields) {
        if (field.value !== undefined) initialValues[field.key] = field.value;
      }
    }

    const [formData, setFormData] = useState<Record<string, string | string[]>>(initialValues);
    const [submitting, setSubmitting] = useState(false);
    const [escapeActive, setEscapeActive] = useState(false);
    const [escapeText, setEscapeText] = useState('');
    const escapeContainerRef = useRef<HTMLDivElement>(null);
    const formContainerRef = useRef<HTMLDivElement>(null);

    const handleFieldChange = useCallback((key: string, value: string | string[]) => {
      setFormData((prev) => ({ ...prev, [key]: value }));
    }, []);

    const handleSubmit = useCallback(async () => {
      if (!onInteractionAction) return;
      setSubmitting(true);
      try {
        if (escapeActive) {
          await onInteractionAction({ payload: { __freeform__: escapeText }, type: 'submit' });
        } else {
          await onInteractionAction({ payload: formData, type: 'submit' });
        }
      } catch (error) {
        console.error(error);
      } finally {
        setSubmitting(false);
      }
    }, [escapeActive, escapeText, formData, onInteractionAction]);

    const handleSkip = useCallback(async () => {
      if (!onInteractionAction) return;
      await onInteractionAction({ type: 'skip' });
    }, [onInteractionAction]);

    const handleEscapeToggle = useCallback(() => {
      setEscapeActive((prev) => !prev);
    }, []);

    useEffect(() => {
      const timer = setTimeout(() => {
        if (escapeActive) {
          const textarea =
            escapeContainerRef.current?.querySelector<HTMLTextAreaElement>('textarea');
          textarea?.focus();
        } else {
          const firstInput =
            formContainerRef.current?.querySelector<HTMLElement>('input, textarea');
          firstInput?.focus();
        }
      }, 0);
      return () => clearTimeout(timer);
    }, [escapeActive]);

    const isFreeform = !question.fields || question.fields.length === 0;

    const isSubmitDisabled = escapeActive
      ? !escapeText.trim()
      : isFreeform
        ? !formData['__freeform__']
        : (question.fields?.some((f) => f.required && !formData[f.key]) ?? false);

    if (!isCustom) {
      return (
        <Flexbox gap={8}>
          <Text>{question.prompt}</Text>
          {question.fields && question.fields.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {question.fields.map((field) => (
                <li key={field.key}>
                  {field.label}
                  {field.required && ' *'}
                </li>
              ))}
            </ul>
          )}
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={12}>
        <Text style={{ fontWeight: 500 }}>{question.prompt}</Text>
        {question.description && (
          <Text style={{ fontSize: 13 }} type="secondary">
            {question.description}
          </Text>
        )}
        {isFreeform ? (
          <TextArea
            autoSize={{ maxRows: 6, minRows: 2 }}
            placeholder={question.description || ''}
            value={formData['__freeform__'] as string}
            onChange={(e) => handleFieldChange('__freeform__', e.target.value)}
          />
        ) : (
          <>
            {!escapeActive && (
              <Flexbox gap={8} ref={formContainerRef}>
                {question.fields!.map((field) => (
                  <Flexbox gap={4} key={field.key}>
                    <Text style={{ fontSize: 13 }}>
                      {field.label}
                      {field.required && <span style={{ color: 'red' }}> *</span>}
                    </Text>
                    <FieldInput
                      field={field}
                      value={formData[field.key]}
                      onChange={handleFieldChange}
                      onPressEnter={() => {
                        if (!isSubmitDisabled) handleSubmit();
                      }}
                    />
                  </Flexbox>
                ))}
              </Flexbox>
            )}

            {/* Escape hatch: bypass form, type freely */}
            {escapeActive ? (
              <Flexbox gap={8} ref={escapeContainerRef}>
                <Text className={styles.escapeLink} type="secondary" onClick={handleEscapeToggle}>
                  <ArrowLeft size={14} /> {t('form.otherBack')}
                </Text>
                <TextArea
                  autoSize={{ maxRows: 6, minRows: 2 }}
                  value={escapeText}
                  onChange={(e) => setEscapeText(e.target.value)}
                />
              </Flexbox>
            ) : (
              <Text className={styles.escapeLink} type="secondary" onClick={handleEscapeToggle}>
                {t('form.other')} <ArrowRight size={14} />
              </Text>
            )}
          </>
        )}
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button onClick={handleSkip}>{t('form.skip')}</Button>
          <Button
            disabled={isSubmitDisabled}
            loading={submitting}
            type="primary"
            onClick={handleSubmit}
          >
            {t('form.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

AskUserQuestionIntervention.displayName = 'AskUserQuestionIntervention';

export default AskUserQuestionIntervention;
