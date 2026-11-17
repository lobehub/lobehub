/**
 * Whether an Agent wrote a public message: every reply, and a request one Agent sent another in
 * their conversation. A deleted Agent's reply keeps `reply` after its reference is cleared.
 */
export const isAgentAuthored = (message: { agentId: string | null; routingStatus: string }) =>
  message.routingStatus === 'reply' || message.agentId !== null;
