import { useEffect, useRef, useState } from 'react';

import type { ExpertiseDomainDraft } from '@/services/expertise';

export interface StoredCreateDraft {
  brief: string;
  draft?: ExpertiseDomainDraft;
}

export const parseStoredCreateDraft = (raw: string | null): StoredCreateDraft => {
  if (!raw) return { brief: '' };

  try {
    const parsed = JSON.parse(raw) as StoredCreateDraft | string;
    if (typeof parsed === 'string') return { brief: parsed };
    return typeof parsed.brief === 'string' ? parsed : { brief: '' };
  } catch {
    // The legacy modal persisted the brief as plain text under the same key.
    return { brief: raw };
  }
};

const readStoredCreateDraft = (storageKey?: string) =>
  parseStoredCreateDraft(storageKey ? localStorage.getItem(storageKey) : null);

export const useCreateDomainDraft = (agentId?: string) => {
  const storageKey = agentId ? `self-learning:create:${agentId}` : undefined;
  const [stored] = useState(() => readStoredCreateDraft(storageKey));
  const [brief, setBrief] = useState(stored.brief);
  const [draft, setDraft] = useState<ExpertiseDomainDraft | undefined>(stored.draft);
  const [step, setStep] = useState<'describe' | 'preparing' | 'review'>(
    stored.draft ? 'review' : 'describe',
  );
  const hydratedStorageKeyRef = useRef(storageKey);
  const skipPersistKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (hydratedStorageKeyRef.current === storageKey) return;

    const next = readStoredCreateDraft(storageKey);
    hydratedStorageKeyRef.current = storageKey;
    skipPersistKeyRef.current = storageKey;
    setBrief(next.brief);
    setDraft(next.draft);
    setStep(next.draft ? 'review' : 'describe');
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    if (skipPersistKeyRef.current === storageKey) {
      skipPersistKeyRef.current = undefined;
      return;
    }

    if (brief.trim() || draft) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ brief, draft } satisfies StoredCreateDraft),
      );
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [brief, draft, storageKey]);

  const clearDraft = () => {
    if (storageKey) localStorage.removeItem(storageKey);
    setBrief('');
    setDraft(undefined);
    setStep('describe');
  };

  return {
    brief,
    clearDraft,
    draft,
    setBrief,
    setDraft,
    setStep,
    step,
    storageKey,
  };
};
