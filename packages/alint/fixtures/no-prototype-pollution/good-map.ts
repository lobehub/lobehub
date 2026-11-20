export const importPreferences = (input: { json: string }) => {
  const preferences = new Map<string, unknown>();
  const imported = JSON.parse(input.json) as Record<string, unknown>;
  for (const [key, value] of Object.entries(imported)) preferences.set(key, value);
  return preferences;
};
