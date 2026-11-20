export const importPreferences = (input: { json: string }) => {
  const preferences: Record<string, unknown> = {};
  const imported = JSON.parse(input.json) as Record<string, unknown>;
  for (const [key, value] of Object.entries(imported)) {
    // alint-expect
    preferences[key] = value;
  }
  return preferences;
};
