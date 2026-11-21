/**
 * The provider whose model ids spell a routing group: magpie serves a model it
 * routes across providers as `group/<id>`, and a group it found itself as
 * `auto/<model>` too.
 *
 * The prefix alone says nothing about another provider's ids: a `group/…` id
 * elsewhere may be an ordinary model's name, so the check is scoped to magpie.
 */
export const ROUTING_GROUP_PROVIDER = 'magpie';

/**
 * Whether a model id names a magpie routing group rather than one provider's
 * model: a set of providers serving one model, a request for it reaching
 * whichever answers.
 */
export const isRoutingGroupId = (id: string, provider?: string) => {
  if (provider !== ROUTING_GROUP_PROVIDER) return false;

  return id.startsWith('group/') || id.startsWith('auto/');
};
