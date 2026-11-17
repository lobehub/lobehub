import { type DeveloperWebhookStore } from './store';

const LIST_KEY = 'all';

/** `undefined` until the list has hydrated or answered. */
const endpointList = (s: DeveloperWebhookStore) => s.endpointListMap[LIST_KEY];

/** `undefined` until that endpoint's deliveries have answered. */
const deliveryList = (endpointId: string) => (s: DeveloperWebhookStore) =>
  s.deliveryListMap[endpointId];

export const developerWebhookSelectors = {
  deliveryList,
  endpointList,
};
