import type { ProjectStatus } from '@lobechat/types';

export type ProjectAcceptanceAction =
  'accept' | 'reopen' | 'reject' | 'requestCompletion' | 'start';

export const getProjectAcceptanceActions = (status: ProjectStatus): ProjectAcceptanceAction[] => {
  switch (status) {
    case 'backlog': {
      return ['start'];
    }
    case 'active':
    case 'paused': {
      return ['requestCompletion'];
    }
    case 'reviewing': {
      return ['reject', 'accept'];
    }
    case 'completed':
    case 'archived': {
      return ['reopen'];
    }
    default: {
      return [];
    }
  }
};
