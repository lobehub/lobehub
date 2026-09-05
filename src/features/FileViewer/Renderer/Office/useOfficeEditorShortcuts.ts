import { useEffect } from 'react';

interface OfficeEditorShortcutOptions {
  dirty: boolean;
  onRedo: () => void;
  onSave: () => void;
  onUndo: () => void;
}

export const useOfficeEditorShortcuts = ({
  dirty,
  onRedo,
  onSave,
  onUndo,
}: OfficeEditorShortcutOptions) => {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        onSave();
      } else if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        onRedo();
      } else if (key === 'z') {
        event.preventDefault();
        onUndo();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dirty, onRedo, onSave, onUndo]);
};
