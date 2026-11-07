import type { StyleAdapter } from '../types';

export const cssModulesAdapter: StyleAdapter = {
  importedStyleSymbols: (source, clause) =>
    source.endsWith('.module.css') && clause.name ? [clause.name.text] : [],
  markerIdentifiers: [],
  name: 'cssModules',
  recognizeFactory: () => false,
  stylesheet: (source, clause) =>
    source.endsWith('.module.css') && clause?.name
      ? { kind: 'module', symbol: clause.name.text }
      : undefined,
};
