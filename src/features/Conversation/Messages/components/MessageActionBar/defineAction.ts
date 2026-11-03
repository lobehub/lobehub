import { type MessageActionDefinition } from './types';

/**
 * Identity helper that narrows an action definition's type at the call site.
 */
export const defineAction = (def: MessageActionDefinition): MessageActionDefinition => def;
