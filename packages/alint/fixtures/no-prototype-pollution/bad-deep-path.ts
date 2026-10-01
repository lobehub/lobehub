export const applyImportedSetting = (
  target: Record<string, unknown>,
  input: { path: string[]; value: unknown },
) => {
  let cursor = target;
  for (const segment of input.path.slice(0, -1)) {
    cursor = cursor[segment] as Record<string, unknown>;
  }
  // alint-expect
  cursor[input.path.at(-1)!] = input.value;
};
