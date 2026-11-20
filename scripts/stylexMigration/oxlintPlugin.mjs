import core from '@lobehub/oxlint-config/plugins/eslint-core';

/**
 * Oxlint loads a plugin file once, so the bundled eslint-core plugin cannot be
 * registered a second time. This local plugin re-exports ESLint's
 * no-restricted-imports under its own name: the src/** blocks already configure
 * eslint-core/no-restricted-imports, and a later block would replace those
 * options rather than add to them.
 */
export default {
  meta: { name: 'stylex-migration' },
  rules: {
    'no-emotion-styles': core.rules['no-restricted-imports'],
    'no-plain-css': core.rules['no-restricted-imports'],
  },
};
