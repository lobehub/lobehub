export const importPreferences = (input: { json: string }) => {
  const preferences: Record<string, unknown> = Object.create(null);
  const imported = JSON.parse(input.json) as Record<string, unknown>;
  for (const [key, value] of Object.entries(imported)) preferences[key] = value;
  return preferences;
};
