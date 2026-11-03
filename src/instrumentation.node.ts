import { register } from '@lobechat/observability-otel/node';

import { version } from '../package.json';

register({ version });
