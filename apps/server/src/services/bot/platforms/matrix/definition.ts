import type { PlatformDefinition } from '../types';
import { MatrixClientFactory } from './client';
import { schema } from './schema';

export const matrix: PlatformDefinition = {
  id: 'matrix',
  name: 'Matrix',
  // Matrix delivers events through a long-poll `/sync` loop — a persistent
  // connection the gateway manager keeps alive, like WeChat's polling.
  connectionMode: 'polling',
  description: 'Connect a Matrix bot on any homeserver (matrix.org, Synapse, Dendrite, Conduit).',
  documentation: {
    portalUrl: 'https://matrix.org',
    setupGuideUrl: 'https://lobehub.com/docs/usage/channels/matrix',
  },
  schema,
  supportsMarkdown: true,
  supportsMessageEdit: true,
  clientFactory: new MatrixClientFactory(),
};
