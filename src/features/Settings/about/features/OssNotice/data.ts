export type OssGroup = 'desktop' | 'runtime';

export interface OssComponent {
  group: OssGroup;
  license: string;
  name: string;
  /** i18n key of a note shown under the name. */
  noteKey?: 'openSourceNotice.note.chromium' | 'openSourceNotice.note.nodeScreenshots';
  /** Upstream original license text. */
  url: string;
}

/**
 * Major components used by the desktop client and web application.
 */
export const OSS_COMPONENTS: OssComponent[] = [
  {
    group: 'desktop',
    license: 'MIT',
    name: 'Electron',
    url: 'https://github.com/electron/electron/blob/main/LICENSE',
  },
  {
    group: 'desktop',
    license: 'BSD-3-Clause',
    name: 'Chromium',
    noteKey: 'openSourceNotice.note.chromium',
    url: 'https://chromium.googlesource.com/chromium/src/+/refs/heads/main/LICENSE',
  },
  {
    group: 'desktop',
    license: 'MIT',
    name: 'electron-updater',
    url: 'https://github.com/electron-userland/electron-builder/blob/master/LICENSE',
  },
  {
    group: 'desktop',
    license: 'MIT',
    name: 'electron-log',
    url: 'https://github.com/megahertz/electron-log/blob/master/LICENSE',
  },
  {
    group: 'desktop',
    license: 'MIT',
    name: 'electron-store',
    url: 'https://github.com/sindresorhus/electron-store/blob/main/license',
  },
  {
    group: 'desktop',
    license: 'MIT',
    name: 'electron-sparkle-updater',
    url: 'https://github.com/innei/electron-sparkle-updater/blob/main/LICENSE',
  },
  {
    group: 'desktop',
    license: 'MIT',
    name: '@lydell/node-pty',
    url: 'https://github.com/lydell/node-pty/blob/split-package/LICENSE',
  },
  {
    group: 'desktop',
    license: 'MIT',
    name: 'get-windows',
    url: 'https://github.com/sindresorhus/get-windows/blob/main/license',
  },
  {
    group: 'desktop',
    license: 'MIT',
    name: 'font-list',
    url: 'https://github.com/oldj/node-font-list/blob/master/LICENSE',
  },
  {
    group: 'desktop',
    license: 'MIT',
    name: 'node-screenshots',
    noteKey: 'openSourceNotice.note.nodeScreenshots',
    url: 'https://github.com/nashaofu/node-screenshots/blob/v0.2.8/LICENSE',
  },
  {
    group: 'desktop',
    license: 'Apache-2.0',
    name: '@anthropic-ai/sandbox-runtime',
    url: 'https://github.com/anthropics/sandbox-runtime/blob/main/LICENSE',
  },
  {
    group: 'runtime',
    license: 'MIT',
    name: 'Next.js',
    url: 'https://github.com/vercel/next.js/blob/canary/license.md',
  },
  {
    group: 'runtime',
    license: 'MIT',
    name: 'React',
    url: 'https://github.com/react/react/blob/main/LICENSE',
  },
  {
    group: 'runtime',
    license: 'MIT',
    name: 'i18next',
    url: 'https://github.com/i18next/i18next/blob/master/LICENSE',
  },
  {
    group: 'runtime',
    license: 'MIT',
    name: 'react-i18next',
    url: 'https://github.com/i18next/react-i18next/blob/master/LICENSE',
  },
  {
    group: 'runtime',
    license: 'MIT',
    name: 'React Router',
    url: 'https://github.com/remix-run/react-router/blob/main/LICENSE.md',
  },
  {
    group: 'runtime',
    license: 'ISC',
    name: 'lucide-react',
    url: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE',
  },
  {
    group: 'runtime',
    license: 'Apache-2.0',
    name: 'pdfjs-dist',
    url: 'https://github.com/mozilla/pdf.js/blob/master/LICENSE',
  },
  {
    group: 'runtime',
    license: 'BSD-2-Clause',
    name: 'mammoth',
    url: 'https://github.com/mwilliamson/mammoth.js/blob/master/LICENSE',
  },
  {
    group: 'runtime',
    license: 'MIT',
    name: 'exceljs',
    url: 'https://github.com/exceljs/exceljs/blob/master/LICENSE',
  },
  {
    group: 'runtime',
    license: 'Apache-2.0',
    name: 'SheetJS (xlsx)',
    url: 'https://github.com/SheetJS/sheetjs/blob/master/LICENSE',
  },
  {
    group: 'runtime',
    license: 'MIT',
    name: 'officeparser',
    url: 'https://github.com/harshankur/officeParser/blob/master/LICENSE',
  },
  {
    group: 'runtime',
    license: 'MIT',
    name: 'ws',
    url: 'https://github.com/websockets/ws/blob/master/LICENSE',
  },
  {
    group: 'runtime',
    license: 'MIT',
    name: 'undici',
    url: 'https://github.com/nodejs/undici/blob/main/LICENSE',
  },
  {
    group: 'runtime',
    license: 'ISC',
    name: 'semver',
    url: 'https://github.com/npm/node-semver/blob/main/LICENSE',
  },
];
