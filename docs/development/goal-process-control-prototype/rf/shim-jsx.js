const R = globalThis.__PROTO_DEPS_NS__?.default?.react ?? {};
const React = R.default ?? R;
const jsx = (type, props, key) => {
  const { children, ...rest } = props || {};
  return key === undefined
    ? React.createElement(
        type,
        rest,
        ...(Array.isArray(children) ? children : children === undefined ? [] : [children]),
      )
    : React.createElement(
        type,
        { ...rest, key },
        ...(Array.isArray(children) ? children : children === undefined ? [] : [children]),
      );
};
export { jsx, jsx as jsxs, jsx as jsxDEV };
export const Fragment = React.Fragment;
