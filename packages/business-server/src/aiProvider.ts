import type { BuiltinModelIdentifier } from 'model-bank';

export const getHiddenBuiltinModelsForUser = async (
  _userId: string,
): Promise<BuiltinModelIdentifier[] | undefined> => [];

/**
 * Retired model id → successor id map. Business implementations may source this
 * from routing configuration; there is none by default.
 */
export const getModelRedirects = async (): Promise<Record<string, string>> => ({});
