import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface UseDeleteProjectConfirmOptions {
  /** Closes the modal after a successful delete. */
  close: () => void;
  onConfirm: () => Promise<void>;
  projectName: string;
}

/**
 * Typed-name confirmation for deleting a project: the delete only runs once the
 * input matches the name, and a failure keeps the modal open for a retry.
 */
export const useDeleteProjectConfirm = ({
  close,
  onConfirm,
  projectName,
}: UseDeleteProjectConfirmOptions) => {
  const { t } = useTranslation('project');
  const [nameInput, setNameInput] = useState('');
  const [loading, setLoading] = useState(false);

  const canContinue = nameInput.trim() === projectName.trim();

  const submit = useCallback(async () => {
    if (!canContinue || loading) return;
    setLoading(true);
    try {
      await onConfirm();
      close();
    } catch (error) {
      console.error('Failed to delete project', error);
      toast.error(t('list.deleteError'));
      setLoading(false);
    }
  }, [canContinue, close, loading, onConfirm, t]);

  return { canContinue, loading, nameInput, setNameInput, submit };
};
