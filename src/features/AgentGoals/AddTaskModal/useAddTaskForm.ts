import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';

interface UseAddTaskFormParams {
  onAdd: (title: string, description?: string) => Promise<void>;
  /** Called after a successful add, typically to close the modal */
  onDone: () => void;
}

export const useAddTaskForm = ({ onAdd, onDone }: UseAddTaskFormParams) => {
  const { t } = useTranslation('chat');
  const [title, setTitleState] = useState('');
  const [description, setDescriptionState] = useState('');
  const [busy, setBusy] = useState(false);
  /** Add failure, shown above the buttons: the modal stays open with the user's input. */
  const [error, setError] = useState<InlineErrorState | null>(null);

  const setTitle = (value: string) => {
    setTitleState(value);
    setError(null);
  };

  const setDescription = (value: string) => {
    setDescriptionState(value);
    setError(null);
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(trimmed, description.trim() || undefined);
      onDone();
    } catch (err) {
      // Keep the form (and the user's input) open — a silent close would be
      // indistinguishable from success.
      console.error('[AddGoalTask] Failed to add task:', err);
      setError(toInlineError(t('goalProcess.addTask.failed'), err));
    } finally {
      setBusy(false);
    }
  };

  return { busy, description, error, setDescription, setTitle, submit, title };
};
