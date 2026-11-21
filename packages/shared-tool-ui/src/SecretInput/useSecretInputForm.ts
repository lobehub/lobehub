import { useCallback, useEffect, useRef, useState } from 'react';

import { detectProseValue } from './detectProseValue';

export interface UseSecretInputFormParams {
  fields: string[];
  /**
   * Receives the plaintext values. A rejection keeps them so the user can
   * retry without re-entering a secret the provider may not show again.
   */
  onSubmit: (values: Record<string, string>) => Promise<void>;
}

/**
 * Value lifecycle of a secret form.
 *
 * Values live in a ref, not React state or any store, so they never reach
 * devtools state snapshots, draft persistence or re-render props. They are
 * dropped after a successful submit or on unmount; a failed submit keeps them
 * for the retry. Only which fields are filled is kept in state.
 *
 * Prose guard: a submit whose values look like prose (a pasted sentence or
 * chat text, the exact T-967 failure) is held instead of handed to the sink;
 * the view shows a warning and calls `confirmProseSubmit` to let it through.
 * Ordinary Save / Enter stays held while the guard is active — only the
 * explicit confirm control can submit a prose-looking value. The
 * acknowledgment survives failed submissions (the retry must not ask the user
 * to confirm the same values again) and resets on a successful submit or when
 * any field is edited.
 */
export const useSecretInputForm = ({ fields, onSubmit }: UseSecretInputFormParams) => {
  const valuesRef = useRef<Record<string, string>>({});
  const [filled, setFilled] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [proseWarning, setProseWarning] = useState<string[] | undefined>();
  // Set only by confirmProseSubmit. Ordinary Save / Enter stays held until
  // this is set, so the explicit "Save anyway" control is the only way a
  // prose-looking value reaches the sink.
  const [proseAcknowledged, setProseAcknowledged] = useState(false);
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
    // Editing a field resets the prose guard: the user must re-confirm.
    setProseWarning(undefined);
    setProseAcknowledged(false);
    setFilled((prev) => {
      const hasValue = value.length > 0;
      if (prev.has(field) === hasValue) return prev;
      const next = new Set(prev);
      if (hasValue) next.add(field);
      else next.delete(field);
      return next;
    });
  }, []);

  const runSubmit = useCallback(async () => {
    const values = Object.fromEntries(fields.map((field) => [field, valuesRef.current[field]]));
    setSubmitting(true);
    try {
      await onSubmit(values);
      // Success: values are consumed and the prose guard resets with them.
      // Failure keeps both for the retry (no re-confirm needed).
      valuesRef.current = {};
      setFilled(new Set());
      setProseWarning(undefined);
      setProseAcknowledged(false);
      setFormKey((key) => key + 1);
    } catch {
      // The caller surfaces the failure; the values stay for the retry.
    } finally {
      setSubmitting(false);
    }
  }, [fields, onSubmit]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;

    const proseFields = fields.filter((field) => detectProseValue(valuesRef.current[field] ?? ''));
    if (proseFields.length > 0 && !proseAcknowledged) {
      // Ordinary Save / Enter always holds prose-looking values until the
      // user activates the explicit "Save anyway" confirm control.
      setProseWarning(proseFields);
      return;
    }

    // Acknowledged (a confirmed submit failed before): retry without asking
    // again; only a successful submit or editing a field resets the guard.
    await runSubmit();
  }, [fields, proseAcknowledged, runSubmit, submitting]);

  const confirmProseSubmit = useCallback(async () => {
    if (submitting) return;
    setProseAcknowledged(true);
    await runSubmit();
  }, [runSubmit, submitting]);

  const complete = fields.length > 0 && fields.every((field) => filled.has(field));

  return {
    complete,
    confirmProseSubmit,
    formKey,
    handleChange,
    handleSubmit,
    proseWarning,
    submitting,
  };
};
