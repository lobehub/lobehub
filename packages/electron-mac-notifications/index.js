/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { loadNativeBinding } = require('@lobechat/napi-loader');
const { randomUUID } = require('node:crypto');

const ID_PREFIX = 'lobehub-';
const SHOW_TIMEOUT_MS = 5000;

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
      console.error('[electron-mac-notifications] invalid event payload:', error);
      return;
    }
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[electron-mac-notifications] event listener failed:', error);
      }
    }
  });
  return setupDone;
};

const decodeAvatar = (avatarDataUrl) => {
  if (!avatarDataUrl || typeof avatarDataUrl !== 'string') return undefined;
  const base64 = avatarDataUrl.replace(/^data:image\/[a-z+]+;base64,/, '');
  if (base64 === avatarDataUrl) return undefined;
  try {
    return Buffer.from(base64, 'base64');
  } catch (error) {
    console.error('[electron-mac-notifications] failed to decode avatar:', error);
    return undefined;
  }
};

const isSupported = () => !!binding;

const onNotificationEvent = (listener) => {
  ensureSetup();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const showNotification = (options) => {
  const id = options.id?.startsWith(ID_PREFIX) ? options.id : `${ID_PREFIX}${randomUUID()}`;
  if (!ensureSetup()) return Promise.resolve({ id, ok: false, reason: 'unsupported' });

  const { sender, ...rest } = options;
  const payload = { ...rest, id };
  if (sender?.name) payload.sender = { conversationId: sender.conversationId, name: sender.name };
  const avatar = decodeAvatar(sender?.avatarDataUrl);

  return new Promise((resolve) => {
    let timer;
    const off = onNotificationEvent((event) => {
      if (event.id !== id) return;
      if (event.type === 'shown') {
        cleanup();
        resolve({ id, ok: true });
      } else if (event.type === 'failed') {
        cleanup();
        resolve({ id, ok: false, reason: event.error || 'failed' });
      }
    });
    const cleanup = () => {
      off();
      clearTimeout(timer);
    };
    // A pending first-run authorization prompt can delay the outcome
    // indefinitely; report the notification as handled instead of failing, so
    // callers don't fall back and double-notify once the user grants access.
    timer = setTimeout(() => {
      cleanup();
      resolve({ id, ok: true, reason: 'pending' });
    }, SHOW_TIMEOUT_MS);

    try {
      binding.show(JSON.stringify(payload), avatar);
    } catch (error) {
      cleanup();
      resolve({ id, ok: false, reason: error.message });
    }
  });
};

const AUTHORIZATION_STATUS = ['notDetermined', 'denied', 'authorized', 'provisional'];

const getAuthorizationStatus = () => {
  if (!binding) return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    binding.getAuthorizationStatus((status) => {
      resolve(AUTHORIZATION_STATUS[status] || 'notDetermined');
    });
  });
};

const requestAuthorization = () => {
  if (!ensureSetup()) return Promise.resolve(false);
  return new Promise((resolve) => {
    binding.requestAuthorization((granted) => resolve(granted));
  });
};

module.exports = {
  getAuthorizationStatus,
  isSupported,
  onNotificationEvent,
  requestAuthorization,
  showNotification,
};
