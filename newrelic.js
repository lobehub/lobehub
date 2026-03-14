'use strict';

exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'lobe-chat'],
  distributed_tracing: { enabled: true },
  license_key: process.env.NEW_RELIC_LICENSE_KEY || '',
  logging: { level: process.env.NEW_RELIC_LOG_LEVEL || 'info' },
};
