/**
 * Aico fail-closed: until the API says unmanaged, never show BYOK unlock UI.
 */
export const isAicoManagedProviderMode = (managed: boolean | undefined): boolean => managed ?? true;
