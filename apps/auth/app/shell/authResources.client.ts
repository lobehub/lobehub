import { AUTH_I18N_SCRIPT_ID, type AuthResourceBundle } from './i18nScript';

const script = () => document.getElementById(AUTH_I18N_SCRIPT_ID);

let parsed: AuthResourceBundle | undefined;

export const readAuthResources = (_locale?: string): AuthResourceBundle => {
  parsed ??= JSON.parse(script()?.textContent || '{}');

  return parsed!;
};

// Returned verbatim so re-rendering the tag produces the exact bytes the
// document was prerendered with.
export const serializeAuthResources = (_locale?: string): string => script()?.textContent ?? '';
