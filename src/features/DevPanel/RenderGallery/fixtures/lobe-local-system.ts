'use client';

import { defineFixtures, single, variants } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-local-system',
  fixtures: {
    editLocalFile: single({
      args: { path: '/workspace/src/spa/router/desktopRouter.config.tsx' },
      pluginState: {
        diffText:
          "--- a/workspace/src/spa/router/desktopRouter.config.tsx\n+++ b/workspace/src/spa/router/desktopRouter.config.tsx\n@@ -1,3 +1,7 @@\n export const desktopRoutes = [\n+  {\n+    path: 'devtools',\n+  },\n ];\n",
      },
    }),
    listLocalFiles: single({
      pluginState: {
        files: [
          { isDirectory: true, name: 'src' },
          { isDirectory: false, name: 'package.json', size: 1320 },
          { isDirectory: false, name: 'README.md', size: 4096 },
        ],
      },
    }),
    moveLocalFiles: single({
      args: {
        items: [
          {
            newPath: '/workspace/src/routes/(main)/devtools/index.tsx',
            oldPath: '/workspace/tmp/devtools-preview.tsx',
          },
        ],
      },
    }),
    readLocalFile: single({
      args: { path: '/workspace/src/routes/(main)/devtools/index.tsx' },
      pluginState: {
        content:
          'export default function DevtoolsPage() {\n  return <div>Render preview</div>;\n}\n',
        endLine: 3,
        fullPath: '/workspace/src/routes/(main)/devtools/index.tsx',
        path: 'src/routes/(main)/devtools/index.tsx',
        startLine: 1,
        totalLines: 3,
      },
    }),
    runCommand: single({
      args: { command: 'bun run type-check' },
      content: 'Checked 1247 files in 2.3s\nNo type errors found.',
      pluginState: {
        exitCode: 0,
        isBackground: false,
        output: 'Checked 1247 files in 2.3s\nNo type errors found.',
        stdout: 'Checked 1247 files in 2.3s\nNo type errors found.',
        success: true,
      },
    }),
    searchLocalFiles: variants([
      {
        args: { keywords: 'quarterly report sample' },
        label: 'Multiple matches',
        pluginState: {
          results: [
            {
              isDirectory: false,
              name: 'sample-quarterly-report-q1.xlsx',
              path: '/Users/sample-user/Downloads/sample-quarterly-report-q1.xlsx',
              size: 9_400,
            },
            {
              isDirectory: false,
              name: 'sample_quarterly_report_q2_draft.xlsx',
              path: '/Users/sample-user/Downloads/sample_quarterly_report_q2_draft.xlsx',
              size: 35_600,
            },
            {
              isDirectory: false,
              name: 'sample-quarterly-report-q3.xlsx',
              path: '/Users/sample-user/Documents/reports/sample-quarterly-report-q3.xlsx',
              size: 8_300,
            },
            {
              isDirectory: false,
              name: 'sample-quarterly-report-archived.xlsx',
              path: '/Users/sample-user/Documents/archive/2024/sample-quarterly-report-archived.xlsx',
              size: 16_200,
            },
          ],
          totalCount: 4,
        },
      },
      {
        args: { keywords: 'no-such-keyword-on-disk' },
        label: 'No results',
        pluginState: {
          results: [],
          totalCount: 0,
        },
      },
    ]),
    writeLocalFile: single({
      args: {
        content: 'export const devtoolsEnabled = process.env.NODE_ENV === "development";\n',
        path: '/workspace/src/routes/(main)/devtools/flags.ts',
      },
    }),
  },
});
