import { styleManager } from 'antd-style';

const RUNTIME_LAYER = 'lobe-runtime';

const cache = styleManager.cache;
const classPrefix = `${cache.key}-`;
const classPattern = new RegExp(`\\.(${classPrefix}[a-z0-9]+)`, 'g');
let index;
let indexedSheets = -1;

const collectClasses = (rule, into) => {
  if (rule.selectorText) {
    for (const match of rule.selectorText.matchAll(classPattern)) into.add(match[1]);
  }
  if (rule.cssRules) for (const child of rule.cssRules) collectClasses(child, into);
};

const buildIndex = () => {
  if (typeof document === 'undefined') return new Map();
  const sheets = document.styleSheets;
  if (sheets.length === indexedSheets) return index;
  indexedSheets = sheets.length;
  index = new Map();
  for (const sheet of sheets) {
    if (!sheet.ownerNode?.hasAttribute?.('data-lobe-static-styles')) continue;
    let layers;
    try {
      layers = sheet.cssRules;
    } catch {
      continue;
    }
    for (const layer of layers) {
      if (!layer.cssRules) continue;
      for (const rule of layer.cssRules) {
        const classes = new Set();
        collectClasses(rule, classes);
        for (const cls of classes) {
          const list = index.get(cls) ?? [];
          list.push(rule);
          index.set(cls, list);
        }
      }
    }
  }
  return index;
};

cache.registered = new Proxy(cache.registered, {
  get(target, key) {
    if (typeof key !== 'string' || key in target || !key.startsWith(classPrefix))
      return target[key];
    const rules = buildIndex().get(key);
    if (!rules) return undefined;
    const text = rules.map((rule) => rule.cssText.replaceAll(`.${key}`, '&')).join('');
    target[key] = text;
    return text;
  },
});

export const layerRule = (rule) =>
  rule.startsWith('@layer') || rule.startsWith('@import')
    ? rule
    : `@layer ${RUNTIME_LAYER}{${rule}}`;

const sheetProto = Object.getPrototypeOf(cache.sheet);
if (!sheetProto.__lobeLayered) {
  const insert = sheetProto.insert;
  sheetProto.__lobeLayered = true;
  sheetProto.insert = function (rule) {
    return insert.call(this, layerRule(rule));
  };
}
