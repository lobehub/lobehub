import { userService } from '@/services/user';
import type { StoreSetter } from '@/store/types';
import type { UserStore } from '@/store/user';
import type { UserAgentOnboarding } from '@/types/user';

type Setter = StoreSetter<UserStore>;

export const createAgentOnboardingSlice = (set: Setter, get: () => UserStore, _api?: unknown) =>
  new AgentOnboardingActionImpl(set, get, _api);

export class AgentOnboardingActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  resetAgentOnboarding = async (): Promise<void> => {
    const agentOnboarding = await userService.resetAgentOnboarding();

    this.#set({ agentOnboarding }, false, 'resetAgentOnboarding');
    await this.#get().refreshUserState();
  };

  updateAgentOnboarding = async (agentOnboarding: UserAgentOnboarding): Promise<void> => {
    await userService.updateAgentOnboarding(agentOnboarding);
    await this.#get().refreshUserState();
  };
}

export type AgentOnboardingAction = Pick<
  AgentOnboardingActionImpl,
  keyof AgentOnboardingActionImpl
>;
