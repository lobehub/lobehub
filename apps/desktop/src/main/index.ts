import './pre-app-init';

import fixPath from 'fix-path';

import { App } from './core/App';
import { installProcessErrorHandlers } from './process-error-handlers';

// Guard the main process against transient network blips (Wi-Fi/VPN switch,
// system sleep) emitted by Electron's net stack as uncaught exceptions.
installProcessErrorHandlers();

const app = new App();

fixPath();
app.bootstrap();
