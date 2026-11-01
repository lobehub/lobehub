const SAFE_KEY = /^[^.[\]]+$/;

export const toLodashPath = (segments: Array<number | string>) => {
  let path = '';

  for (const segment of segments) {
    if (typeof segment === 'number') {
      path += `[${segment}]`;
      continue;
    }

    const key = segment;
    const safe = SAFE_KEY.test(key);
    if (safe) {
      path += path ? `.${key}` : key;
      continue;
    }

    path += `[${JSON.stringify(key)}]`;
  }

  return path;
};
