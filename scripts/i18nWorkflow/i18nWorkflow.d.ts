import type { Config } from '@lobehub/i18n-cli';

export interface WorkflowConfig extends Config {
  /**
   * Root directory of the source locale files.
   *
   * This field is only used by the local i18n workflow scripts and has no relation
   * to `@lobehub/i18n-cli` — it will not be consumed by the CLI.
   * Use it to point to the correct locale source when working across multiple apps
   * (e.g. `src/locales/default` for web, `apps/desktop/src/main/locales/default` for desktop).
   *
   * @example 'src/locales/default'
   * @example 'apps/desktop/src/main/locales/default'
   */
  sourceDir: string;
}
