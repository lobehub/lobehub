import { styleManager } from 'antd-style';

const cache = styleManager.cache;
const prefixLength = cache.key.length + 1;

export const insertPrecompiledStyle = (className, rules) => {
  const name = className.slice(prefixLength);
  if (cache.inserted[name] === undefined) {
    for (const rule of rules) cache.sheet.insert(rule);
    cache.inserted[name] = true;
  }
  const define = (descriptor) => Object.defineProperty(cache.registered, className, descriptor);
  define({
    configurable: true,
    enumerable: true,
    get: () => rules.map((rule) => rule.replaceAll(`.${className}`, '&')).join(''),
    set: (value) => define({ configurable: true, enumerable: true, value, writable: true }),
  });
  return className;
};
