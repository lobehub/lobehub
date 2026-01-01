import type { SerializedParseResult } from '../../index';
import simple from './simple.json';
import withSupervisorReply from './with-supervisor-reply.json';

export const agentCouncil = {
  simple: simple as unknown as SerializedParseResult,
  withSupervisorReply: withSupervisorReply as unknown as SerializedParseResult,
};
