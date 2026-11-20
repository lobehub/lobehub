import type { DashboardWidgetVersionItem } from '@/services/dashboard';

export const RUNTIME_LANGUAGE: Record<string, string> = {
  bash: 'bash',
  node: 'javascript',
  python: 'python',
};

/** A diff reads as a change to the code, not to a missing trailing newline. */
export const withTrailingNewline = (value: string) =>
  value === '' || value.endsWith('\n') ? value : `${value}\n`;

/**
 * Show every line. Widget scripts are short, and the collapsed-context
 * separator of the diff renderer is a hardcoded English label ("N unmodified
 * lines") that cannot be localized.
 */
export const DIFF_OPTIONS = { expandUnchanged: true };

/** The declarative half of a version: everything besides the script. */
export const contractOf = (version: DashboardWidgetVersionItem) =>
  JSON.stringify(
    {
      manifest: version.manifest ?? null,
      outputType: version.outputType,
      runtime: version.runtime,
      view: version.view ?? null,
    },
    null,
    2,
  );
