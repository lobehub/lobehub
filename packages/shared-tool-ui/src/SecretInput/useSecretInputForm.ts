import { useCallback, useEffect, useRef, useState } from 'react';

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
 */
export const useSecretInputForm = ({ fields, onSubmit }: UseSecretInputFormParams) => {
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

  const handleSubmit = useCallback(async () => {
    const values = Object.fromEntries(fields.map((field) => [field, valuesRef.current[field]]));
    setSubmitting(true);
    try {
      await onSubmit(values);
      valuesRef.current = {};
      setFilled(new Set());
      setFormKey((key) => key + 1);
    } catch {
      // The caller surfaces the failure; the values stay for the retry.
    } finally {
      setSubmitting(false);
    }
  }, [fields, onSubmit]);

  const complete = fields.length > 0 && fields.every((field) => filled.has(field));

  return { complete, formKey, handleChange, handleSubmit, submitting };
};
