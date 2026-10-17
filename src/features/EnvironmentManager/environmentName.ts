// Match sandboxStorage's trimmed name schema without discarding the user's draft.
export const ENVIRONMENT_NAME_MAX_LENGTH = 255;

export const validateEnvironmentName = (name: string): 'required' | 'tooLong' | undefined => {
  if (!name.trim()) return 'required';
  if (name.trim().length > ENVIRONMENT_NAME_MAX_LENGTH) return 'tooLong';
  return undefined;
};
