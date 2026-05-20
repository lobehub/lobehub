export interface WorkspacePanelSection {
  id: 'progress' | 'resources';
  title: string;
}

export interface WorkspaceProgressItem {
  id: string;
  status: 'todo' | 'processing' | 'completed';
  text: string;
}

export interface WorkspaceProgressState {
  completionPercent: number;
  currentTask?: string;
  items: WorkspaceProgressItem[];
  title?: string;
  updatedAt?: string;
}

export interface ResourceGroupItem {
  id: string;
  subtitle?: string;
  title: string;
  type: string;
}

export interface ResourceGroupState {
  groupKey: string;
  items: ResourceGroupItem[];
  label: string;
}
