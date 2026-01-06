import type { Message } from '../../../../types';
import simple from './simple.json';
import withSupervisorReply from './with-supervisor-reply.json';

export const agentCouncil = {
  simple: simple as Message[],
  withSupervisorReply: withSupervisorReply as Message[],
};
