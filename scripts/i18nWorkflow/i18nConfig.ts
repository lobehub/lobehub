import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const config = require('../../.i18nrc');

export default config;
