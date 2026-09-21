const cdnBase = (process.env.VITE_CDN_BASE || '').replace(/\/+$/, '');

export const antdStaticCssOptions = {
  hrefTemplate: (hash) => `${cdnBase}/assets/antd-${hash}.css`,
};

export const themeVarsCssOptions = {
  hrefTemplate: (hash) => `${cdnBase}/assets/theme-vars-${hash}.css`,
};
