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
 * Whether the primary Save button must stay disabled: blocked (lookup failed /
 * permission lost / type mismatch — the fields are replaced by the reason, so
 * a completed form must not submit over it), inert (disabled or a write in
 * flight), a prose confirmation pending (handleSubmit rejects ordinary saves
 * until `confirmProseSubmit` runs, so a clickable Save would only look stuck),
 * or incomplete without a prose confirmation pending. The secondary "Save
 * anyway" control has its own gates and is unaffected by this predicate.
 */
export const isSecretSubmitDisabled = ({
  blockedReason,
  complete,
  inert,
  proseWarning,
}: {
  blockedReason?: ReactNode;
  complete: boolean;
  inert: boolean;
  proseWarning?: string[] | undefined;
}) => inert || !!blockedReason || !!proseWarning || (!complete && !proseWarning);

/**
 * Password-style form for secrets that must not enter the agent context. See
 * {@link useSecretInputForm} for how long the values are kept, and for the
 * prose guard that holds a submit whose values look like pasted chat text
 * (a CJK sentence or a long multi-word paste) until the user confirms.
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
    const {
      complete,
      confirmProseSubmit,
      formKey,
      handleChange,
      handleSubmit,
      proseWarning,
      submitting,
    } = useSecretInputForm({ fields, onSubmit });

    const inert = disabled || submitting;

    const proseActions = proseWarning && (
      <Flexbox gap={8} role={'alert'}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon color={cssVar.colorWarning} icon={CircleAlert} size={14} />
          <Text fontSize={12} type={'warning'}>
            {labels.proseWarning(proseWarning)}
          </Text>
        </Flexbox>
        <Button
          disabled={inert || !!blockedReason}
          loading={submitting}
          onClick={() => void confirmProseSubmit()}
          size={'small'}
        >
          {labels.confirmProse}
        </Button>
      </Flexbox>
    );

    const actions = (
      <Flexbox gap={8}>
        {proseActions}
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={inert} onClick={onCancel}>
            {labels.cancel}
          </Button>
          <Button
            disabled={isSecretSubmitDisabled({ blockedReason, complete, inert, proseWarning })}
            loading={submitting}
            type={'primary'}
            onClick={() => void handleSubmit()}
          >
            {submitting ? labels.submitting : labels.submit}
          </Button>
        </Flexbox>
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
                    if (complete || proseWarning) void handleSubmit();
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
