import { verifyEvidenceTypes } from '@lobechat/const/verify';

import { log } from '../../../utils/logger';

export type VerifierType = 'agent' | 'llm' | 'program';
export type OnFail = 'auto_repair' | 'manual';
export type Decision = 'accepted' | 'overridden' | 'rejected';

export const VERIFIER_TYPES: VerifierType[] = ['program', 'agent', 'llm'];
export const ON_FAIL: OnFail[] = ['manual', 'auto_repair'];
export const DECISIONS: Decision[] = ['accepted', 'rejected', 'overridden'];
/** The evidence media a plan item may require — the same closed set the executor gates on. */
export const EVIDENCE_TYPES = verifyEvidenceTypes;

export function parseConfig(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    log.error('--config must be valid JSON');
    process.exit(1);
  }
}

export function assertEnum<T extends string>(
  value: T | undefined,
  allowed: T[],
  flag: string,
): void {
  if (value !== undefined && !allowed.includes(value)) {
    log.error(`${flag} must be one of: ${allowed.join(', ')}`);
    process.exit(1);
  }
}
