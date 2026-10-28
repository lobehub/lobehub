/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { loadNativeBinding } = require('@lobechat/napi-loader');

const binding =
  process.platform === 'darwin' && process.type !== 'renderer'
    ? loadNativeBinding({ dirname: __dirname, packageName: require('./package.json').name })
    : null;

/**
 * Whether ScreenCaptureKit can produce stills here. False on macOS 13 and
 * older, where `SCScreenshotManager` does not exist yet; callers fall back.
 */
const isSupported = () => !!binding && binding.isSupported();

/**
 * Screen Recording as ScreenCaptureKit sees it right now.
 *
 * Only call this once the prompt-free tccd query says the permission is on: an
 * unresolved permission makes ScreenCaptureKit raise the system prompt.
 */
const probeCapturePermission = () => (binding ? binding.probePermission() : null);

/**
 * Displays and windows with their frames in points — the same unit as Electron
 * screen bounds — or `null` when ScreenCaptureKit cannot answer.
 */
const screenShareableContent = () => {
  if (!binding) return null;
  const payload = binding.shareableContent();
  if (!payload || payload === 'null') return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const unsupported = () => Promise.resolve({ png: null, reason: 'unsupported' });

const captureWindow = (windowId) => (binding ? binding.captureWindow(windowId) : unsupported());

const captureRect = (rect) => (binding ? binding.captureRect(rect) : unsupported());

module.exports = {
  captureRect,
  captureWindow,
  isSupported,
  probeCapturePermission,
  screenShareableContent,
};
