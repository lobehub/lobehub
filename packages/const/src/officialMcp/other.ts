import { favicon, type OfficialMcpServerType } from './types';

export const OTHER_SERVERS: OfficialMcpServerType[] = [
  {
    auth: 'oauth',
    author: 'Tessie',
    category: 'other',
    description: 'Check Tesla vehicle status and data through Tessie',
    icon: favicon('tessie.com'),
    identifier: 'tessie',
    label: 'Tessie',
    url: 'https://mcp.tessie.com',
  },
  {
    auth: 'oauth',
    author: 'Upwork',
    category: 'other',
    description: 'Find freelance jobs and talent on Upwork',
    icon: favicon('upwork.com'),
    identifier: 'upwork',
    label: 'Upwork',
    url: 'https://mcp.upwork.com/mcp',
  },
  {
    auth: 'oauth',
    author: 'Withings',
    category: 'other',
    description: 'Read your Withings health measurements',
    icon: favicon('withings.com'),
    identifier: 'withings',
    label: 'Withings',
    url: 'https://mcp.withings.com/mcp',
  },
];
