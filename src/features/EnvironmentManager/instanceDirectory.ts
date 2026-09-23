import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';

/**
 * A folder name for an instance, derived from what it is called.
 *
 * The folder is the one field in the dialog with no obvious answer — it is a
 * name in a filesystem nobody has seen, asked for before the person has any
 * reason to care where their files land. Almost always the right answer is "a
 * folder of its own, named after this instance", so that is what the field
 * offers; it stays editable for the times it is not.
 *
 * Returns an empty string when nothing usable is left, which leaves the field
 * blank and the button disabled — better than a folder called `-`.
 */
export const suggestInstanceDirectory = (name: string): string => {
  const slug = name
    .toLowerCase()
    .trim()
    // Everything a single path segment should not carry, the separator
    // included: a suggestion must never quietly nest one instance inside
    // another's tree.
    .replaceAll(/[^\da-z._-]+/gu, '-')
    .replaceAll(/-{2,}/gu, '-')
    // Leading dots would make it hidden, and `.sandbox` in particular is where
    // environment snapshots live — an instance rooted there would run inside
    // the store it is restored from. Stripping them sidesteps both.
    .replace(/^[.-]+/u, '')
    .replace(/[.-]+$/u, '');

  return slug && isSafeSandboxCwd(slug) ? slug : '';
};
