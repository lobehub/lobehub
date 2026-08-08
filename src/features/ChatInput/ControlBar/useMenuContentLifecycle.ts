import { useCallback, useRef, useState } from 'react';

export const useMenuContentLifecycle = <T>(onSelect: (value: T) => void) => {
  const [contentActive, setContentActive] = useState(false);
  const [open, setOpen] = useState(false);
  const pendingSelectionRef = useRef<T | undefined>(undefined);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setContentActive(true);
  }, []);

  const deferSelection = useCallback((value: T) => {
    pendingSelectionRef.current = value;
    setOpen(false);
  }, []);

  const handleOpenChangeComplete = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) return;

      setContentActive(false);
      if (pendingSelectionRef.current === undefined) return;

      const value = pendingSelectionRef.current;
      pendingSelectionRef.current = undefined;
      onSelect(value);
    },
    [onSelect],
  );

  return {
    contentActive,
    deferSelection,
    handleOpenChange,
    handleOpenChangeComplete,
    open,
  };
};
