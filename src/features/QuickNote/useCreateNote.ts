import { useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useQuickNoteStore } from '@/store/quickNote';

export const useCreateNote = () => {
  const createNote = useQuickNoteStore((s) => s.createNote);
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(async () => {
    const id = await createNote();
    navigate(`/note/${id}`);
  }, [createNote, navigate]);
};
