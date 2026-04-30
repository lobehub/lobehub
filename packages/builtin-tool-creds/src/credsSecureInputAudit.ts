import type { DynamicInterventionResolver } from '@lobechat/types';

/**
 * Dynamic intervention resolver for saveCreds secure input mode.
 * Returns true (intervention needed) when `values` is missing/empty
 * and `fields` is provided — indicating the user wants secure input.
 */
export const credsSecureInputAudit: DynamicInterventionResolver = async (toolArgs) => {
  const values = toolArgs.values;
  const fields = toolArgs.fields;

  // Secure input mode: fields provided but no values
  if (
    fields &&
    Array.isArray(fields) &&
    fields.length > 0 &&
    (!values || (typeof values === 'object' && Object.keys(values).length === 0))
  ) {
    return true;
  }

  // Direct save mode: values provided, no intervention needed
  return false;
};
