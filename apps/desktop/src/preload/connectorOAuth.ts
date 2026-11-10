import { ipcRenderer } from 'electron';

import { CONNECTOR_OAUTH_RESULT_CHANNEL } from '../common/connectorOAuth';

// This preload exposes no desktop APIs. The main process verifies the sending
// frame, callback URL and OAuth state before accepting a status message.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.type !== 'lobe-connector-oauth') return;
  ipcRenderer.send(CONNECTOR_OAUTH_RESULT_CHANNEL, event.data);
});
