export const AuvIdentifier = 'lobe-auv';

export const AuvApiName = {
  runCommand: 'runCommand',
} as const;

export type AuvApiNameType = (typeof AuvApiName)[keyof typeof AuvApiName];

export interface AuvRunCommandParams {
  /** AUV arguments after the executable name, for example ['invoke', 'display.list']. */
  argv: string[];
}
