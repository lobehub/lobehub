import { getUserStoreState } from '@/store/user/store';

export const loginRequired = {
  redirect: ({ reason }: { reason?: 'sessionExpired' } = {}) => {
    void getUserStoreState().openLogin(reason);
  },
};
