import { memo, useEffect, useRef } from 'react';

import { openEditorModal } from '@/features/EditorModal';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

const LAYER_MAP = {
  activity: LayersEnum.Activity,
  context: LayersEnum.Context,
  experience: LayersEnum.Experience,
  identity: LayersEnum.Identity,
  preference: LayersEnum.Preference,
};

const EditableModal = memo(() => {
  const editingMemoryId = useUserMemoryStore((s) => s.editingMemoryId);
  const editingMemoryContent = useUserMemoryStore((s) => s.editingMemoryContent);
  const editingMemoryLayer = useUserMemoryStore((s) => s.editingMemoryLayer);
  const clearEditingMemory = useUserMemoryStore((s) => s.clearEditingMemory);
  const updateMemory = useUserMemoryStore((s) => s.updateMemory);

  // Held in a ref rather than in the effect's deps: the editor snapshots the
  // memory when it opens, so an unrelated store update must not tear down and
  // reopen a modal the user is typing in.
  const openEditorRef = useRef<() => ReturnType<typeof openEditorModal>>(undefined);
  openEditorRef.current = () =>
    openEditorModal({
      value: editingMemoryContent,
      onClose: clearEditingMemory,
      onConfirm: async (value) => {
        if (!editingMemoryId || !editingMemoryLayer) return;
        await updateMemory(editingMemoryId, value, LAYER_MAP[editingMemoryLayer]);
      },
    });

  useEffect(() => {
    if (!editingMemoryId) return;
    const instance = openEditorRef.current!();
    return () => instance.close();
  }, [editingMemoryId]);

  return null;
});

export default EditableModal;
