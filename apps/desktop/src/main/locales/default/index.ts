import common from './common';
import dialog from './dialog';
import menu from './menu';

/**
 * Source locale barrel. `scripts/i18nWorkflow` requires this directory to
 * generate `resources/locales/en` and to diff it before `lobe-i18n` runs, so
 * it must export every namespace even though the app loads them one by one.
 */
const resources = {
  common,
  dialog,
  menu,
} as const;

export default resources;
