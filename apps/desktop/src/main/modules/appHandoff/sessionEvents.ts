import { EventEmitter } from 'node:events';

/**
 * Signals that the desktop sign-in changed (tokens saved or cleared, server
 * switched), so the app handoff interface can start, stop or re-publish
 * itself. An emitter instead of a controller call keeps RemoteServerConfigCtr
 * free of a dependency on the handoff controller.
 */
export const desktopSessionEvents = new EventEmitter();

export const notifyDesktopSessionChanged = () => {
  desktopSessionEvents.emit('changed');
};
