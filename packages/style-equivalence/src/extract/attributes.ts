const escape = (text: string) => text.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

export const isStateAttribute = (name: string) => /^(?:aria|data)-[\w-]+$/.test(name);

export const booleanAttribute = (code: string, name: string) => {
  const selector = new RegExp(`\\[${escape(name)}(?:\\s*=\\s*(['"]?)([^'"\\]]*)\\1)?\\s*\\]`, 'g');
  const values = [...code.matchAll(selector)].map((match) => match[2]);
  return (
    values.length > 0 &&
    values.every((value) => value === undefined || value === 'true' || value === 'false')
  );
};
