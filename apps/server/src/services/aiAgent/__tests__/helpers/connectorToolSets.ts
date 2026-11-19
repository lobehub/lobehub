import { vi } from 'vitest';

type Resolve = (...args: any[]) => unknown;

/**
 * A `ConnectorModel.resolveToolSets` mock answering from the per-identifier
 * mocks a test already sets up (`resolveByIdentifiers` for named identifiers,
 * `resolveAll` otherwise). Each row is one tool set keyed by its identifier,
 * as a shared row is; a test about same-identifier rows sets `toolIdentifier`.
 */
export const toolSetsFrom = (byIdentifiers?: Resolve, all?: Resolve) =>
  vi.fn(async (target: unknown, identifiers?: string[]) => {
    const rows = (
      identifiers ? await byIdentifiers?.(identifiers, target) : await all?.(target)
    ) as { identifier: string; toolIdentifier?: string }[] | undefined;
    return (rows ?? []).map((row) => ({
      ...row,
      toolIdentifier: row.toolIdentifier ?? row.identifier,
    }));
  });
