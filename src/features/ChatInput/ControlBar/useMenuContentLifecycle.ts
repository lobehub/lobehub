import { useCallback, useRef, useState } from 'react';

export const useMenuContentLifecycle = <T>(onSelect: (value: T) => void) => {
  const [open, setOpen] = useState(false);
  const pendingSelectionRef = useRef<T | undefined>(undefined);

  const deferSelection = useCallback((value: T) => {
    pendingSelectionRef.current = value;
    setOpen(false);
  }, []);

  const handleOpenChangeComplete = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) return;
      if (pendingSelectionRef.current === undefined) return;

      const value = pendingSelectionRef.current;
      pendingSelectionRef.current = undefined;
      onSelect(value);
    },
    [onSelect],
  );

  return {
    deferSelection,
    handleOpenChange: setOpen,
    handleOpenChangeComplete,
    open,
  };
};
