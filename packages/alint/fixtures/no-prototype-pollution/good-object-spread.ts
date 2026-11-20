export const importPreferences = (input: { json: string }) => ({ ...JSON.parse(input.json) });
