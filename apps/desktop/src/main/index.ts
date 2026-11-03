import './pre-app-init';

import { App } from './core/App';
import { installProcessErrorHandlers } from './process-error-handlers';

const mainBootstrapKey = '__LOBEHUB_DESKTOP_MAIN_BOOTSTRAPPED__' as const;
const mainProcessGlobal = globalThis as typeof globalThis & {
  [mainBootstrapKey]?: boolean;
};

// Rolldown may make a deferred CommonJS chunk reference exports that remain in
// the main entry. Electron does not cache its entry exactly like a normal CJS
// require, so that back-reference can evaluate this module again. Keep the
// entry side effects idempotent as a correctness backstop while shared modules
// are assigned to neutral chunks in the Vite config.
if (!mainProcessGlobal[mainBootstrapKey]) {
  mainProcessGlobal[mainBootstrapKey] = true;

  // Guard the main process against transient network blips (Wi-Fi/VPN switch,
  // system sleep) emitted by Electron's net stack as uncaught exceptions.
  installProcessErrorHandlers();

  const app = new App();
  void app.bootstrap();
}
