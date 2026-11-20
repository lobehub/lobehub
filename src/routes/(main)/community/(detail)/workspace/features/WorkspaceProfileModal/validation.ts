const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const URL_PATTERN = /^(?:(?:[a-z]+:)?\/\/|www\.)\S+$/i;

// Inputs are validated trimmed because the availability check and the submitted
// payload are trimmed; checking the raw value flags a pasted " acme" as malformed
// while the status beside it reports it available.
export const getNamespaceError = (value: string): 'length' | 'pattern' | undefined => {
  const namespace = value.trim();
  if (namespace.length < 3 || namespace.length > 32) return 'length';
  if (!NAMESPACE_PATTERN.test(namespace)) return 'pattern';
};

export const isNamespaceFormatValid = (value: string) => getNamespaceError(value) === undefined;

export const isWebsiteUrlValid = (value: string) => URL_PATTERN.test(value.trim());
