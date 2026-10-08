const { EventEmitter } = require('node:events');
const path = require('node:path');

// Rescue cannot import the core: this bridge remains usable when core startup fails.
function createSparkleUpdater({ app, feedUrl, resourcesPath }) {
  if (!feedUrl) throw new Error('Sparkle rescue requires an update server URL');
  const bridge = require(path.join(resourcesPath, 'sparkle', 'sparkle_bridge.node'));
  app.on('will-quit', () => bridge.setEventHandler(null));
  const events = new EventEmitter();
  let updateInfo;
  let downloaded = false;
  let resolveCheck;
  let rejectCheck;
  let resolveDownload;
  let rejectDownload;

  bridge.setEventHandler((event) => {
    switch (event.type) {
      case 'update-available': {
        updateInfo = { version: event.version };
        resolveCheck?.({ isUpdateAvailable: true, updateInfo });
        resolveCheck = rejectCheck = undefined;
        break;
      }
      case 'update-not-available': {
        resolveCheck?.({ isUpdateAvailable: false });
        resolveCheck = rejectCheck = undefined;
        break;
      }
      case 'download-progress': {
        if (event.phase === 'download') events.emit('download-progress', event);
        break;
      }
      case 'update-downloaded': {
        downloaded = true;
        resolveCheck?.({ isUpdateAvailable: true, updateInfo: { version: event.version } });
        resolveCheck = rejectCheck = undefined;
        resolveDownload?.();
        resolveDownload = rejectDownload = undefined;
        break;
      }
      case 'error': {
        const error = new Error(event.message ?? 'Sparkle rescue update failed');
        rejectCheck?.(error);
        rejectDownload?.(error);
        resolveCheck = rejectCheck = resolveDownload = rejectDownload = undefined;
        events.emit('error', error);
        break;
      }
    }
  });
  if (!bridge.init({ appcastUrl: `${feedUrl}/appcast-${process.arch}.xml` })) {
    throw new Error('Sparkle rescue initialization failed');
  }
  bridge.setAutomaticChecks(false);

  return {
    checkForUpdates: () =>
      new Promise((resolve, reject) => {
        resolveCheck = resolve;
        rejectCheck = reject;
        bridge.checkForUpdates();
      }),
    downloadUpdate: () =>
      downloaded
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
            resolveDownload = resolve;
            rejectDownload = reject;
          }),
    on: events.on.bind(events),
    quitAndInstall: () => bridge.installUpdateNow(),
  };
}

module.exports = { createSparkleUpdater };
