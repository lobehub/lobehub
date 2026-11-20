import type { StyleAdapter } from '../types';

export const globalCssAdapter: StyleAdapter = {
  markerIdentifiers: [],
  name: 'globalCss',
  recognizeFactory: () => false,
  stylesheet: (source, clause) =>
    source.endsWith('.css') && !source.endsWith('.module.css') && !clause
      ? { kind: 'global' }
      : undefined,
};
