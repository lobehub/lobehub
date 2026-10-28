/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { loadNativeBinding } = require('@lobechat/napi-loader');

const binding =
  process.platform === 'darwin' && process.type !== 'renderer'
    ? loadNativeBinding({ dirname: __dirname, packageName: require('./package.json').name })
    : null;

const isSupported = () => binding?.isSupported() === true;

const setWindowGlass = (nativeWindowHandle, enabled, dark) => {
  if (!binding) return false;
  try {
    return binding.setWindowGlass(nativeWindowHandle, enabled, dark) === true;
  } catch (error) {
    console.error('[electron-mac-sidebar-glass] Failed to update window material:', error);
    return false;
  }
};

module.exports = { isSupported, setWindowGlass };
