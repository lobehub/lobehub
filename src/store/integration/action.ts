import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { initialIntegrationState, type IntegrationState } from './initialState';
import { IntegrationPrivateAction } from './privateAction';
import { INTEGRATION_PARAMS } from './projection';
import { useIntegrationStore } from './store';

const n = setNamespace('integration');

/** The overview card and the detail page mount the same reads. */
const DEDUPING_INTERVAL = 10_000;

type Setter = StoreSetter<IntegrationState>;

export class IntegrationActionImpl {
  readonly #private: IntegrationPrivateAction;
  readonly #set: Setter;

  constructor(set: Setter, _get: () => IntegrationState, privateAction: IntegrationPrivateAction) {
    this.#set = set;
    this.#private = privateAction;
  }

  reset = (): void => {
    this.#set(initialIntegrationState, false, n('reset'));
  };

  /** Config, identity and installations of the GitHub integration; flags of all three. */
  useFetchGithub = () => {
    const options = { dedupingInterval: DEDUPING_INTERVAL };
    const config = this.#private.scmConfig.useSync(INTEGRATION_PARAMS, options);
    const identity = this.#private.scmIdentity.useSync(INTEGRATION_PARAMS, options);
    const installations = this.#private.scmInstallations.useSync(INTEGRATION_PARAMS, options);
    return {
      error: config.error ?? installations.error ?? identity.error,
      isValidating: config.isValidating || identity.isValidating || installations.isValidating,
    };
  };

  refreshGithub = () =>
    Promise.all([
      this.#private.scmConfig.fetch(INTEGRATION_PARAMS, { fresh: true }),
      this.#private.scmIdentity.fetch(INTEGRATION_PARAMS, { fresh: true }),
      this.#private.scmInstallations.fetch(INTEGRATION_PARAMS, { fresh: true }),
    ]);
}

export const integrationActions = new IntegrationActionImpl(
  useIntegrationStore.setState,
  useIntegrationStore.getState,
  new IntegrationPrivateAction(useIntegrationStore.setState, useIntegrationStore.getState),
);
