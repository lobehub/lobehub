/**
 * Whether a model id names a routing group rather than one provider's model.
 *
 * magpie keeps a routing group as `group/<id>`, and hands a group it found out
 * as `auto/<model>` too, the model's name as the vendor spells it. Either way a
 * request for it reaches whichever of the group's providers answers.
 */
export const isRoutingGroupId = (id: string) => id.startsWith('group/') || id.startsWith('auto/');
