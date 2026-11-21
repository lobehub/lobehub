import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LocalAcceptanceSource } from '@lobechat/utils/verify/localAcceptance';

/**
 * The offline acceptance page, built by `apps/workbench` (`build:report`) and
 * shipped next to the CLI bundle. One self-contained HTML file: the CLI only
 * writes the acceptance into it.
 */
export const REPORT_TEMPLATE_FILE = 'acceptance-report.html';

const DATA_MARKER = '<!--ACCEPTANCE_LOCAL_DATA-->';
const TITLE_MARKER = '<!--ACCEPTANCE_LOCAL_TITLE-->';
/** Read back by `apps/workbench/src/localReport/localReportData.ts`. */
const DATA_ELEMENT_ID = 'acceptance-local-data';

const candidates = () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    process.env.LOBEHUB_ACCEPTANCE_REPORT_TEMPLATE,
    // The published bundle: dist/index.js beside dist/acceptance-report.html.
    path.join(here, REPORT_TEMPLATE_FILE),
    // A source checkout (`bun src/index.ts`): the workbench's build output.
    path.resolve(here, '../../../../../workbench/dist-report', REPORT_TEMPLATE_FILE),
  ].filter((file): file is string => Boolean(file));
};

export const resolveReportTemplate = (): string => {
  const found = candidates().find((file) => existsSync(file));
  if (!found)
    throw new Error(
      `The local report page is missing from this CLI (${REPORT_TEMPLATE_FILE}). Reinstall @lobehub/cli, or build it with \`bun run build:report\` in apps/workbench.`,
    );
  return found;
};

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** JSON that cannot close or confuse the `<script>` element carrying it. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

const replaceMarker = (html: string, marker: string, value: string, last = false) => {
  const index = last ? html.lastIndexOf(marker) : html.indexOf(marker);
  if (index === -1) throw new Error(`The local report page has no ${marker} slot`);
  return html.slice(0, index) + value + html.slice(index + marker.length);
};

export const renderReportHtml = (
  template: string,
  source: LocalAcceptanceSource,
  title: string,
): string => {
  const withTitle = replaceMarker(template, TITLE_MARKER, `<title>${escapeHtml(title)}</title>`);
  // The slot sits in <body>, after the inlined page script in <head>.
  return replaceMarker(
    withTitle,
    DATA_MARKER,
    `<script id="${DATA_ELEMENT_ID}" type="application/json">${scriptJson(source)}</script>`,
    true,
  );
};

export const readReportTemplate = () => readFileSync(resolveReportTemplate(), 'utf8');
