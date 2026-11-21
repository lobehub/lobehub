import { safeParseJSON } from '@lobechat/utils';

export interface ToolParametersShape {
  properties?: Record<string, unknown>;
  required?: string[];
}

/**
 * Recover arguments whose only defect is one extra `}` after a complete object.
 *
 * The extra brace can also mean the model closed a nested object too early, which
 * leaves that object's later keys at the top level. Requiring every top-level key
 * to be declared, and every required key to be present, refuses that case instead
 * of running the tool on a reshaped payload.
 */
export const recoverSurplusClosingBrace = (
  argsStr: string,
  parameters?: ToolParametersShape,
): Record<string, unknown> | undefined => {
  const declared = parameters?.properties;
  if (!declared) return undefined;

  const trimmed = argsStr.trimEnd();
  if (!trimmed.endsWith('}')) return undefined;
  const candidate = trimmed.slice(0, -1).trimEnd();
  if (!candidate.endsWith('}')) return undefined;

  const parsed = safeParseJSON<unknown>(candidate);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

  const args = parsed as Record<string, unknown>;
  const keysAreDeclared = Object.keys(args).every((key) => Object.hasOwn(declared, key));
  const requiredPresent = (parameters.required ?? []).every((key) => Object.hasOwn(args, key));
  return keysAreDeclared && requiredPresent ? args : undefined;
};
