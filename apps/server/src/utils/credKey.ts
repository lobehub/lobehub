import { randomBytes } from 'node:crypto';

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 6;
const SLUG_MAX_LENGTH = 40;
const FALLBACK_SLUG = 'cred';

const randomSuffix = () =>
  Array.from(
    randomBytes(SUFFIX_LENGTH),
    (byte) => SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length],
  ).join('');

/**
 * The identifier agents look a credential up by. Users never type or see it:
 * it is derived from the display name (`OpenAI API Key` → `openai-api-key-x7k2m9`)
 * so an agent reading the credential list can still tell rows apart, and the
 * random suffix keeps it unique within the account without a lookup.
 * Names with no ASCII letters or digits fall back to `cred-<suffix>`.
 */
export const generateCredKey = (name: string): string => {
  const slug = name
    .normalize('NFKD')
    // Drop the combining marks NFKD splits off, so `é` becomes `e` rather than a word break.
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .slice(0, SLUG_MAX_LENGTH)
    .replaceAll(/^-+|-+$/g, '');

  return `${slug || FALLBACK_SLUG}-${randomSuffix()}`;
};

/** A caller-supplied key wins (agents and skills ask for fixed keys); otherwise one is generated. */
export const resolveCredKey = (input: { key?: string; name: string }): string =>
  input.key?.trim() || generateCredKey(input.name);
