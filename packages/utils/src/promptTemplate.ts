import { get } from 'es-toolkit/compat';

export const hydrationPrompt = (prompt: string, context: any) => {
  const regex = /{{([\S\s]+?)}}/g;

  // Use String.prototype.replace with a replacer function
  return prompt.replaceAll(regex, (match, key) => {
    const trimmedKey = key.trim();

    // Safely get the value from the context, including nested paths
    const value = get(context, trimmedKey);

    // If the value exists (is not undefined), convert it to string and return.
    // Otherwise, return an empty string to replace the placeholder.
    return value !== undefined ? String(value) : '';
  });
};
