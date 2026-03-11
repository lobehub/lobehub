import { userService } from '@/services/user';
import { type StoreSetter } from '@/store/types';
import { type UserStore } from '@/store/user';
import { type UserGuide, type UserLab, type UserPreference } from '@/types/user';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('preference');

type Setter = StoreSetter<UserStore>;
export const createPreferenceSlice = (set: Setter, get: () => UserStore, _api?: unknown) =>
  new PreferenceActionImpl(set, get, _api);

export class PreferenceActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  updateGuideState = async (guide: Partial<UserGuide>, action?: any): Promise<void> => {
    const { updatePreference } = this.#get();
    const nextGuide = merge(this.#get().preference.guide, guide);
    await updatePreference({ guide: nextGuide }, action);
  };

  updateLab = async (lab: Partial<UserLab>, action?: any): Promise<void> => {
    const { updatePreference } = this.#get();
    const nextLab = merge(this.#get().preference.lab, lab);
    await updatePreference({ lab: nextLab }, action || n('updateLab'));
  };

  updatePreference = async (preference: Partial<UserPreference>, action?: any): Promise<void> => {
    const nextPreference = merge(this.#get().preference, preference);

    this.#set({ preference: nextPreference }, false, action || n('updatePreference'));

    await userService.updatePreference(nextPreference);
  };
}

export type PreferenceAction = Pick<PreferenceActionImpl, keyof PreferenceActionImpl>;
