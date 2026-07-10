import type { TreeDataState } from './types';

export interface TreeInitialState extends TreeDataState {
  epoch: number;
  errors: Record<string, unknown>;
  expanded: Record<string, boolean>;
  knowledgeBaseId: string | null;
}

export const initialTreeState: TreeInitialState = {
  children: {},
  epoch: 0,
  errors: {},
  expanded: {},
  knowledgeBaseId: null,
  status: {},
};
