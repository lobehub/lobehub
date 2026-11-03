import { taskLabelService } from '@/services/taskLabel';

import { resolveToolLabelIds } from '../../labels';

/** Label names → ids against the registry; throws a tool-readable message. */
export const resolveLabelIdsOrThrow = async (
  names: string[] | undefined,
  allowGroups = false,
): Promise<string[]> => {
  if (!names?.some((name) => name.trim())) return [];
  const result = resolveToolLabelIds(await taskLabelService.list(), names, { allowGroups });
  if (result.error) throw new Error(result.error);
  return result.ids;
};
