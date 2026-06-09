import './pre-app-init';

import fixPath from 'fix-path';

import { App } from './core/App';

const app = new App();

fixPath();
app.bootstrap();
