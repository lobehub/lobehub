import { create } from 'zustand';

export interface EditingTarget {
  anchor: HTMLElement;
  avatar?: string;
  id: string;
  memberAvatars?: { avatar?: string; background?: string }[];
  title: string;
  type: 'agent' | 'group' | 'agentGroup';
}

interface EditingPopoverState {
  close: () => void;
  open: (target: EditingTarget) => void;
  target: EditingTarget | null;
}

export const useEditingPopoverStore = create<EditingPopoverState>((set) => ({
  close: () => set({ target: null }),
  open: (target) => set({ target }),
  target: null,
}));

export const openEditingPopover = (target: EditingTarget) =>
  useEditingPopoverStore.getState().open(target);

export const closeEditingPopover = () => useEditingPopoverStore.getState().close();
