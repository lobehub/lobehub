import { styleManager } from 'antd-style';

const cache = styleManager.cache;
const prefixLength = cache.key.length + 1;

export const insertPrecompiledStyle = (className, rules, registered) => {
  const name = className.slice(prefixLength);
  if (cache.inserted[name] === undefined) {
    for (const rule of rules) cache.sheet.insert(rule);
    cache.inserted[name] = true;
  }
  cache.registered[className] = registered;
  return className;
};
