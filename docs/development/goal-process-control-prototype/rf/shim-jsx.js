const R = globalThis.__PROTO_DEPS_NS__?.default?.react ?? {};
const React = R.default ?? R;
const jsx = (type, props, key) => {
  const { children, ...rest } = props || {};
  const kids = Array.isArray(children) ? children : children === undefined ? [] : [children];
  return key === undefined
    ? React.createElement(type, rest, ...kids)
    : React.createElement(type, { ...rest, key }, ...kids);
};
export { jsx, jsx as jsxs, jsx as jsxDEV };
export const Fragment = React.Fragment;
