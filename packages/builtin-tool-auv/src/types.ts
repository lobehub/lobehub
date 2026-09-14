export const AuvIdentifier = 'lobe-computer-use';

export const AuvApiName = {
  runCommand: 'runCommand',
} as const;

export type AuvApiNameType = (typeof AuvApiName)[keyof typeof AuvApiName];

export interface AuvRunCommandParams {
  /** AUV arguments after the executable name, for example ['invoke', 'display.list']. */
  argv: string[];
  /** Brief user-facing purpose of this action; never interpreted as CLI arguments. */
  reasoning?: string;
}
