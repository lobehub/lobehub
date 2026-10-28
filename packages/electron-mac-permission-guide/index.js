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

/**
 * Screen Recording authorization as tccd reports it right now.
 *
 * Unlike `CGPreflightScreenCaptureAccess`, this is not cached for the process
 * lifetime, so a permission the user grants while the app runs is visible on
 * the very next call. Returns `null` when the native guide is unavailable.
 */
const screenCaptureStatus = () => (binding ? binding.screenCaptureStatus() : null);

/**
 * Whether this process can already read other apps' window titles, which
 * Screen Recording gates. A `true` here means the grant is live in this
 * process and capture needs no relaunch. Returns `null` when unavailable.
 */
const canReadOtherAppWindowTitles = () => (binding ? binding.canReadOtherAppWindowTitles() : null);

module.exports = {
  activateSettings,
  canReadOtherAppWindowTitles,
  hideGuide,
  isSupported,
  onGuideEvent,
  screenCaptureStatus,
  showGuide,
};
