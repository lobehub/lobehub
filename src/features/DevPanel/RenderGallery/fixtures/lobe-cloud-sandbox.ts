'use client';

import { defineFixtures, single, variants } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-cloud-sandbox',
  fixtures: {
    editLocalFile: single({
      args: { path: '/sandbox/src/routes/devtools.tsx' },
      pluginState: {
        diffText:
          '--- a/sandbox/src/routes/devtools.tsx\n+++ b/sandbox/src/routes/devtools.tsx\n@@ -1,2 +1,3 @@\n export const devtools = true;\n+export const previews = true;\n',
        linesAdded: 1,
        linesDeleted: 0,
        replacements: 1,
      },
    }),
    executeCode: single({
      args: {
        code: 'const tools = ["todo", "file_change", "command_execution"]; console.log(tools.length);',
        language: 'typescript',
      },
      pluginState: {
        output: '3',
        stderr: '',
      },
    }),
    exportFile: single({
      args: { path: '/sandbox/reports/devtools-preview.html' },
      pluginState: {
        downloadUrl: 'https://example.com/devtools-preview.html',
        filename: 'devtools-preview.html',
        success: true,
      },
    }),
    listLocalFiles: variants([
      {
        args: { directoryPath: '/sandbox/src/routes' },
        label: 'Mixed entries',
        pluginState: {
          files: [
            { isDirectory: true, name: 'agent' },
            { isDirectory: false, name: 'index.tsx', size: 2048 },
            { isDirectory: false, name: 'devtools.tsx', size: 4096 },
          ],
        },
      },
      {
        args: { directoryPath: '/sandbox/empty' },
        label: 'Empty directory',
        pluginState: { files: [] },
      },
      {
        args: { directoryPath: '/sandbox/many' },
        label: 'Many files',
        pluginState: {
          files: Array.from({ length: 24 }, (_, i) => ({
            isDirectory: false,
            name: `report-${i.toString().padStart(2, '0')}.csv`,
            size: 4096 + i * 128,
          })),
        },
      },
    ]),
    moveLocalFiles: single({
      pluginState: {
        results: [
          {
            destination: '/sandbox/archive/devtools-preview.tsx',
            source: '/sandbox/tmp/devtools-preview.tsx',
            success: true,
          },
        ],
        successCount: 1,
        totalCount: 1,
      },
    }),
    readLocalFile: single({
      args: { path: '/sandbox/src/routes/devtools.tsx' },
      pluginState: {
        content: 'export default function Devtools() {\n  return <div>Preview</div>;\n}\n',
        endLine: 3,
        startLine: 1,
        totalLines: 3,
      },
    }),
    runCommand: variants([
      {
        args: { command: 'bunx vitest run src/spa/router/desktopRouter.sync.test.tsx' },
        content: '1 passed',
        label: 'Tests pass',
        pluginState: {
          exitCode: 0,
          isBackground: false,
          output: '1 passed',
          stdout: '1 passed',
          success: true,
        },
      },
      {
        args: { command: 'bunx vitest run src/spa/router/desktopRouter.sync.test.tsx' },
        content:
          'FAIL  src/spa/router/desktopRouter.sync.test.tsx > desktop router config sync\n  expected route /devtools but received undefined.\n',
        label: 'Test failure',
        pluginState: {
          exitCode: 1,
          isBackground: false,
          output:
            'FAIL  src/spa/router/desktopRouter.sync.test.tsx > desktop router config sync\n  expected route /devtools but received undefined.\n',
          stderr:
            'FAIL  src/spa/router/desktopRouter.sync.test.tsx > desktop router config sync\n  expected route /devtools but received undefined.\n',
          success: false,
        },
      },
    ]),
    searchLocalFiles: variants([
      {
        args: { directory: '/sandbox/src', keyword: 'devtools' },
        label: 'Two matches',
        pluginState: {
          results: [
            { isDirectory: false, name: 'devtools.tsx', path: '/sandbox/src/routes/devtools.tsx' },
            {
              isDirectory: false,
              name: 'desktopRouter.config.tsx',
              path: '/sandbox/src/spa/router/desktopRouter.config.tsx',
            },
          ],
          totalCount: 2,
        },
      },
      {
        args: { directory: '/sandbox/src', keyword: 'no-such-keyword' },
        label: 'No results',
        pluginState: {
          results: [],
          totalCount: 0,
        },
      },
    ]),
    writeLocalFile: single({
      args: {
        content: 'export const isDevtoolsEnabled = true;\n',
        path: '/sandbox/src/routes/devtools/flags.ts',
      },
    }),
  },
});
