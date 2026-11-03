import { useEffect } from 'react';
import useMergeState from 'use-merge-value';

import { useShowMobileWorkspace } from '@/hooks/useShowMobileWorkspace';
import { useServerConfigStore } from '@/store/serverConfig';

export const useWorkspaceModal = (
  value?: boolean,
  onChange?: (v: boolean) => void,
): [boolean, (v: boolean) => void] => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const showMobileWorkspace = useShowMobileWorkspace();
  const [isModalOpen, setIsModalOpen] = useMergeState(false, {
    defaultValue: false,
    onChange,
    value,
  });

  useEffect(() => {
    if (!mobile) return;
    if (!showMobileWorkspace) {
      setIsModalOpen(false);
    }
  }, [mobile, showMobileWorkspace]);

  return [isModalOpen, setIsModalOpen];
};
