import { type ToolExecutionContext } from '../types';

/**
 * Factory function type for creating server runtimes
 */
export type ServerRuntimeFactory = (context: ToolExecutionContext) => any;

/**
 * Server runtime registration object
 */
export interface ServerRuntimeRegistration {
  factory: ServerRuntimeFactory;
  identifier: string;
}
