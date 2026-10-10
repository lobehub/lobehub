'use client';

import { Button, cssVar, Flexbox, Icon, InputPassword, Text } from '@lobehub/ui';
import { CircleAlert } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { SecretInputLabels } from './types';
import { useSecretInputForm } from './useSecretInputForm';

export interface SecretInputViewProps {
  /**
   * When present, the submit / cancel footer is portaled here so it stays
   * pinned below scrollable content (same contract as `AskUserQuestionView`).
   */
  actionsPortalTarget?: HTMLElement | null;
  /**
   * Why the user cannot enter the secret here, e.g. a missing permission.
   * Replaces the fields and disables submit; cancel stays available.
   */
  blockedReason?: ReactNode;
  disabled?: boolean;
  /** Short, human-readable failure message; never the sink's raw error. */
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
   * state, stores or logs. A rejection keeps the values so the user can retry.
   */
  onSubmit: (values: Record<string, string>) => Promise<void>;
}

/**
 * Password-style form for secrets that must not enter the agent context. See
 * {@link useSecretInputForm} for how long the values are kept.
 */
const SecretInputView = memo<SecretInputViewProps>(
  ({
    actionsPortalTarget,
    blockedReason,
    disabled,
    error,
    fields,
    labels,
    notice,
    onCancel,
    onSubmit,
  }) => {
    const { complete, formKey, handleChange, handleSubmit, submitting } = useSecretInputForm({
      fields,
      onSubmit,
    });

    const inert = disabled || submitting;
    const canSubmit = !inert && !blockedReason && complete;

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
        {blockedReason ? (
          <Text fontSize={12} type={'warning'}>
            {blockedReason}
          </Text>
        ) : (
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
        )}
        {error && (
          <Flexbox horizontal align={'center'} gap={6} role={'alert'}>
            <Icon color={cssVar.colorError} icon={CircleAlert} size={14} />
            <Text fontSize={12} type={'danger'}>
              {error}
            </Text>
          </Flexbox>
        )}
        {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
      </Flexbox>
    );
  },
);

SecretInputView.displayName = 'SecretInputView';

export default SecretInputView;
