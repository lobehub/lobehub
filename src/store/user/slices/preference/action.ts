import type { StateCreator } from 'zustand/vanilla';

import { userService } from '@/services/user';
import type { UserStore } from '@/store/user';
import { type UserGuide, type UserLab, type UserPreference } from '@/types/user';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('preference');

export interface PreferenceAction {
  updateGuideState: (guide: Partial<UserGuide>) => Promise<void>;
  updateLab: (lab: Partial<UserLab>) => Promise<void>;
  updatePreference: (preference: Partial<UserPreference>, action?: any) => Promise<void>;
}

export const createPreferenceSlice: StateCreator<
  UserStore,
  [['zustand/devtools', never]],
  [],
  PreferenceAction
> = (set, get) => ({
  updateGuideState: async (guide) => {
    const { updatePreference } = get();
    const nextGuide = merge(get().preference.guide, guide);
    await updatePreference({ guide: nextGuide });
  },

  updateLab: async (lab) => {
    const { updatePreference } = get();
    const nextLab = merge(get().preference.lab, lab);
    await updatePreference({ lab: nextLab }, n('updateLab'));
  },

  updatePreference: async (preference, action) => {
    const nextPreference = merge(get().preference, preference);

    set({ preference: nextPreference }, false, action || n('updatePreference'));

    await userService.updatePreference(nextPreference);
  },
});
