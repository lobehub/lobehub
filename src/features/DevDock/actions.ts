import { confirmModal, toast } from '@lobehub/ui/base-ui';

import { isDesktop } from '@/const/version';
import { getUserStoreState } from '@/store/user';

export const triggerResetOnboarding = () => {
  confirmModal({
    content:
      'Clear user onboarding progress (step + finishedAt) so the onboarding flow runs again.',
    okButtonProps: { danger: true },
    okText: 'Reset',
    onOk: async () => {
      try {
        await getUserStoreState().resetOnboarding();
      } catch (error) {
        console.error('[DevDock] Failed to reset user onboarding:', error);
        toast.error({ title: 'Failed to reset user onboarding' });
        return;
      }

      if (isDesktop) {
        toast.success({ title: 'User onboarding reset' });
      } else {
        window.location.href = '/onboarding';
      }
    },
    title: 'Reset user onboarding?',
  });
};

export const triggerOpenDevtools = () => {
  void import('@/services/electron/devtools').then((m) => m.electronDevtoolsService.openDevtools());
};
