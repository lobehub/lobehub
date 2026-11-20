/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { loadNativeBinding } = require('@lobechat/napi-loader');

const binding =
  process.platform === 'darwin' && process.type !== 'renderer'
    ? loadNativeBinding({ dirname: __dirname, packageName: require('./package.json').name })
    : null;

const listeners = new Set();
let setupDone = false;

const ensureSetup = () => {
  if (!binding) return false;
  if (setupDone) return true;
  setupDone = binding.setup((eventJson) => {
    let event;
    try {
      event = JSON.parse(eventJson);
    } catch (error) {
      console.error('[electron-mac-permission-guide] invalid event payload:', error);
      return;
    }
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[electron-mac-permission-guide] event listener failed:', error);
      }
    }
  });
  return setupDone;
};

const isSupported = () => !!binding;

const onGuideEvent = (listener) => {
  ensureSetup();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const showGuide = (state) => {
  if (!ensureSetup()) return false;
  binding.show(JSON.stringify(state));
  return true;
};

const hideGuide = () => {
  if (binding) binding.hide();
};

const activateSettings = () => {
  if (binding) binding.activateSettings();
};

module.exports = { activateSettings, hideGuide, isSupported, onGuideEvent, showGuide };
