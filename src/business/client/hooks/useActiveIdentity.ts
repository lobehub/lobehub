import { useActiveWorkspace } from './useActiveWorkspace';

export interface ActiveIdentity {
  avatar?: string | null;
  name?: string | null;
}

export const useActiveIdentity = (): ActiveIdentity | null => {
  const workspace = useActiveWorkspace();

  return workspace ? { avatar: workspace.avatar, name: workspace.name } : null;
};
