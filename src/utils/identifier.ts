/**
 * Turn id like `docs_123` to `123`. Or add prefix to the identifier.
 * @param identifier - The identifier to standardize.
 * @returns The standardized identifier.
 */

const standardizeIdentifier = (identifier: string, prefix?: 'docs' | 'agt') => {
  if (identifier.includes('_')) {
    return identifier.split('_')[1];
  } else if (prefix) {
    return `${prefix}_${identifier}`;
  }

  return identifier;
};

export { standardizeIdentifier };
