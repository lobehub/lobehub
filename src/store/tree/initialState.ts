import type { TreeDataState } from './types';

export interface TreeInitialState extends TreeDataState {
  epoch: number;
  expanded: Record<string, boolean>;
  knowledgeBaseId: string | null;
}

export const initialTreeState: TreeInitialState = {
  children: {},
  epoch: 0,
  expanded: {},
  knowledgeBaseId: null,
  status: {},
};
