/** Heterogeneous CLI types that stay hidden until their Labs flag is on. */
export const isExperimentalHeterogeneousAgentType = (type: string | undefined): boolean =>
  type === 'minimax-code';

export const isHeterogeneousAgentTypeEnabled = (
  type: string | undefined,
  labs: { enableMinimaxCode?: boolean } = {},
): boolean => type !== 'minimax-code' || Boolean(labs.enableMinimaxCode);
