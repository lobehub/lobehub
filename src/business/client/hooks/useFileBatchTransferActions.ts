import type { LucideIcon } from 'lucide-react';

export interface FileBatchTransferAction {
  icon: LucideIcon;
  key: string;
  label: string;
  onClick: () => void;
}

export const useFileBatchTransferActions = (
  _selectCount: number,
): FileBatchTransferAction[] | null => null;
