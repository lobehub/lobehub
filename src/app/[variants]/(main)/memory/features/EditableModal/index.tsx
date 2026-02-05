import { memo } from 'react';

import { EditorModal } from '@/features/EditorModal';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

const EditableModal = memo(() => {
  const editingMemoryId = useUserMemoryStore((s) => s.editingMemoryId);
  const editingMemoryContent = useUserMemoryStore((s) => s.editingMemoryContent);
  const editingMemoryLayer = useUserMemoryStore((s) => s.editingMemoryLayer);
  const clearEditingMemory = useUserMemoryStore((s) => s.clearEditingMemory);
  const updateMemory = useUserMemoryStore((s) => s.updateMemory);

  const layerMap = {
    activity: LayersEnum.Activity,
    context: LayersEnum.Context,
    experience: LayersEnum.Experience,
    identity: LayersEnum.Identity,
    preference: LayersEnum.Preference,
  };

  return (
    <EditorModal
      open={!!editingMemoryId}
      value={editingMemoryContent}
      onCancel={clearEditingMemory}
      onConfirm={async (value) => {
        if (!editingMemoryId || !editingMemoryLayer) return;
        await updateMemory(editingMemoryId, value, layerMap[editingMemoryLayer]);
      }}
    />
  );
});

export default EditableModal;
