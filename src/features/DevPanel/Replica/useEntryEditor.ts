import { useState } from 'react';

import type { ReplicaDevtoolsEntry } from '@/libs/replica/devtools';

import { parseReplicaDraft, serializeReplicaDraft } from './model';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const useEntryEditor = (
  entry: ReplicaDevtoolsEntry | undefined,
  key: string | undefined,
) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persist, setPersist] = useState(true);

  const start = () => {
    if (!entry || key === undefined) return;
    try {
      setDraft(serializeReplicaDraft(entry.read(key)));
      setError(null);
    } catch (cause) {
      setError(`Cannot edit this value as JSON: ${errorMessage(cause)}`);
    }
  };

  const cancel = () => {
    setDraft(null);
    setError(null);
  };

  const apply = () => {
    if (!entry || key === undefined || draft === null) return;
    try {
      entry.update(key, parseReplicaDraft(draft), { persist });
      cancel();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return {
    apply,
    cancel,
    draft,
    error,
    isEditing: draft !== null,
    persist,
    setDraft: (value: string) => {
      setDraft(value);
      setError(null);
    },
    setPersist,
    start,
  };
};
