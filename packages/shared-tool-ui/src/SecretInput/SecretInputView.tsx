'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button, InputPassword, Text } from '@lobehub/ui/base-ui';
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { SecretInputLabels } from './types';

export interface SecretInputViewProps {
  /**
   * When present, the submit / cancel footer is portaled here so it stays
   * pinned below scrollable content (same contract as `AskUserQuestionView`).
   */
  actionsPortalTarget?: HTMLElement | null;
  disabled?: boolean;
  /** Non-secret failure message from the sink, shown above the fields. */
  error?: string;
  /** Field names to collect, e.g. environment variable names. */
  fields: string[];
  labels: SecretInputLabels;
  /** Context shown above the fields, e.g. where the secret will be stored. */
  notice?: ReactNode;
  onCancel: () => void;
  /**
   * Receives the plaintext values. The caller must hand them straight to its
   * sink (a credential store, a device vault) and report only a non-secret
   * reference onwards — never put them in tool arguments, results, plugin
   * state, stores or logs. A rejection keeps the form open so the user can
   * retry.
   */
  onSubmit: (values: Record<string, string>) => Promise<void>;
}

/**
 * Password-style form for secrets that must not enter the agent context.
 *
 * Values live in a ref, not React state or any store, so they never reach
 * devtools state snapshots, draft persistence or re-render props, and they are
 * dropped as soon as the submit settles or the card unmounts. Only which
 * fields are filled is kept in state, to enable the submit button.
 */
const SecretInputView = memo<SecretInputViewProps>(
  ({ actionsPortalTarget, disabled, error, fields, labels, notice, onCancel, onSubmit }) => {
    const valuesRef = useRef<Record<string, string>>({});
    const [filled, setFilled] = useState<Set<string>>(() => new Set());
    const [submitting, setSubmitting] = useState(false);
    // Bumping the key remounts the uncontrolled inputs, clearing their DOM values.
    const [formKey, setFormKey] = useState(0);

    useEffect(
      () => () => {
        valuesRef.current = {};
      },
      [],
    );

    const handleChange = useCallback((field: string, value: string) => {
      valuesRef.current[field] = value;
      setFilled((prev) => {
        const hasValue = value.length > 0;
        if (prev.has(field) === hasValue) return prev;
        const next = new Set(prev);
        if (hasValue) next.add(field);
        else next.delete(field);
        return next;
      });
    }, []);

    const clear = useCallback(() => {
      valuesRef.current = {};
      setFilled(new Set());
      setFormKey((key) => key + 1);
    }, []);

    const handleSubmit = useCallback(async () => {
      const values = Object.fromEntries(fields.map((field) => [field, valuesRef.current[field]]));
      setSubmitting(true);
      try {
        await onSubmit(values);
      } catch {
        // The caller surfaces the failure through `error`; the user re-enters.
      } finally {
        clear();
        setSubmitting(false);
      }
    }, [clear, fields, onSubmit]);

    const inert = disabled || submitting;
    const canSubmit = !inert && fields.length > 0 && fields.every((field) => filled.has(field));

    const actions = (
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={inert} onClick={onCancel}>
          {labels.cancel}
        </Button>
        <Button disabled={!canSubmit} loading={submitting} type={'primary'} onClick={handleSubmit}>
          {submitting ? labels.submitting : labels.submit}
        </Button>
      </Flexbox>
    );

    return (
      <Flexbox gap={12}>
        {notice}
        {error && <Alert title={error} type={'error'} />}
        <Flexbox gap={8} key={formKey}>
          {fields.map((field) => (
            <Flexbox gap={4} key={field}>
              <Text fontSize={12} type={'secondary'}>
                {field}
              </Text>
              <InputPassword
                data-1p-ignore
                autoComplete={'off'}
                data-lpignore={'true'}
                disabled={inert}
                placeholder={labels.placeholder(field)}
                spellCheck={false}
                onChange={(event) => handleChange(field, event.target.value)}
                onPressEnter={() => {
                  if (canSubmit) void handleSubmit();
                }}
              />
            </Flexbox>
          ))}
        </Flexbox>
        {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
      </Flexbox>
    );
  },
);

SecretInputView.displayName = 'SecretInputView';

export default SecretInputView;
