import { genCdnUrl } from '@lobehub/ui';
import type { CSSProperties } from 'react';

// Pierre's unsafeCSS is captured at FileTree construction with no public
// setter, so we can't rebuild this string in response to tree changes. Drive
// the file-icon offset through a CSS custom property the wrapper sets — custom
// properties cascade through shadow DOM, so toggling it on the host reflows
// the offset live (see `getExplorerTreeStyleVars`).
const FILE_ICON_OFFSET_VAR = '--explorer-file-icon-offset';
const FOLDER_ICON_SIZE = '18px';
const FILE_ICON_SIZE = '16px';

// Chevron column width + row gap at default density (16 + 6). We standardised
// consumers on default density, so this matches `--trees-icon-width` +
// `--trees-item-row-gap` exactly.
const RESERVED_FILE_ICON_OFFSET = '22px';

// Lucide `file-text` glyph (v1.17.0), matched to the Pages (文稿) list item icon
// so document rows read as manuscripts rather than generic files. Painted as a
// CSS mask (not a background-image) so the slot inherits the themed tree
// foreground color instead of the colored material `file.svg`.
const FILE_TEXT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;

const MATERIAL_FILE_ICON_ASSETS_URL = genCdnUrl({
  path: 'assets',
  pkg: '@lobehub/assets-fileicon',
  version: '1.0.0',
});

const MATERIAL_FOLDER_ICON_RULES = [
  { iconName: 'folder-github', names: ['.github', 'github', '_github', '__github__'] },
  {
    iconName: 'folder-vscode',
    names: ['.vscode', 'vscode', '.vscode-test', 'vscode-test'],
  },
  { iconName: 'folder-docs', names: ['docs', 'doc', 'documents', 'documentation'] },
  { iconName: 'folder-src', names: ['src', 'source', 'sources', 'code'] },
  { iconName: 'folder-node', names: ['node_modules'] },
  { iconName: 'folder-app', names: ['app', 'apps'] },
  { iconName: 'folder-packages', names: ['package', 'packages', 'pkg', 'pkgs'] },
  { iconName: 'folder-public', names: ['public', 'web'] },
  { iconName: 'folder-scripts', names: ['script', 'scripts'] },
  { iconName: 'folder-i18n', names: ['i18n', 'locale', 'locales'] },
  { iconName: 'folder-temp', names: ['tmp', 'temp'] },
  { iconName: 'folder-next', names: ['.next', 'next'] },
  { iconName: 'folder-husky', names: ['.husky', 'husky'] },
  { iconName: 'folder-git', names: ['.git', 'git', '.githooks', 'githooks'] },
  { iconName: 'folder-container', names: ['.devcontainer', 'devcontainer', 'container'] },
  { iconName: 'folder-command', names: ['command', 'commands', 'cmd', 'cli'] },
  { iconName: 'folder-test', names: ['test', 'tests', '__test__', '__tests__'] },
  { iconName: 'folder-mock', names: ['mock', 'mocks', '__mock__', '__mocks__'] },
  { iconName: 'folder-resource', names: ['asset', 'assets', 'resource', 'resources'] },
  { iconName: 'folder-components', names: ['component', 'components'] },
  { iconName: 'folder-routes', names: ['route', 'routes'] },
  { iconName: 'folder-server', names: ['server', 'backend'] },
  { iconName: 'folder-client', names: ['client', 'frontend'] },
  { iconName: 'folder-desktop', names: ['desktop'] },
  { iconName: 'folder-mobile', names: ['mobile'] },
  { iconName: 'folder-views', names: ['page', 'pages', 'view', 'views'] },
  { iconName: 'folder-config', names: ['.config', 'config', 'configs'] },
  { iconName: 'folder-environment', names: ['.env', '.envs', 'env', 'envs'] },
  { iconName: 'folder-database', names: ['db', 'database'] },
  { iconName: 'folder-class', names: ['model', 'models'] },
  { iconName: 'folder-controller', names: ['service', 'services'] },
  { iconName: 'folder-hook', names: ['hook', 'hooks'] },
  { iconName: 'folder-typescript', names: ['type', 'types', 'typings'] },
  { iconName: 'folder-utils', names: ['util', 'utils', 'utilities'] },
  { iconName: 'folder-plugin', names: ['plugin', 'plugins'] },
  { iconName: 'folder-shared', names: ['common', 'shared'] },
  { iconName: 'folder-css', names: ['style', 'styles'] },
  { iconName: 'folder-images', names: ['image', 'images', 'icon', 'icons'] },
  { iconName: 'folder-markdown', names: ['md', 'markdown'] },
  { iconName: 'folder-json', names: ['json'] },
  { iconName: 'folder-javascript', names: ['js', 'javascript'] },
  { iconName: 'folder-console', names: ['console', 'shell'] },
] satisfies { iconName: string; names: string[] }[];

const MATERIAL_FILE_EXTENSION_RULES = [
  { extensions: ['tsx'], iconName: 'react_ts' },
  { extensions: ['jsx'], iconName: 'react' },
  { extensions: ['ts', 'mts', 'cts'], iconName: 'typescript' },
  { extensions: ['js', 'mjs', 'cjs'], iconName: 'javascript' },
  { extensions: ['json', 'jsonc', 'json5', 'jsonl'], iconName: 'json' },
  { extensions: ['md'], iconName: 'markdown' },
  { extensions: ['mdx'], iconName: 'mdx' },
  { extensions: ['yml', 'yaml'], iconName: 'yaml' },
  { extensions: ['sh', 'bash', 'zsh', 'fish'], iconName: 'console' },
  { extensions: ['env'], iconName: 'tune' },
  { extensions: ['svg'], iconName: 'svg' },
  { extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'], iconName: 'image' },
  { extensions: ['css'], iconName: 'css' },
  { extensions: ['scss', 'sass'], iconName: 'sass' },
  { extensions: ['less'], iconName: 'less' },
  { extensions: ['lock'], iconName: 'lock' },
  { extensions: ['log'], iconName: 'log' },
  { extensions: ['txt'], iconName: 'document' },
] satisfies { extensions: string[]; iconName: string }[];

const MATERIAL_FILE_NAME_RULES = [
  { iconName: 'codeowners', names: ['CODEOWNERS', 'OWNERS'] },
  { iconName: 'git', names: ['.gitignore', '.gitmodules', '.gitattributes', '.gitkeep'] },
  { iconName: 'npm', names: ['.npmrc', '.npmignore'] },
  { iconName: 'nodejs', names: ['.nvmrc', '.node-version', 'package.json', 'package-lock.json'] },
  { iconName: 'docker', names: ['.dockerignore', 'Dockerfile'] },
  { iconName: 'bun', names: ['bun.lockb', 'bunfig.toml'] },
  { iconName: 'markdown', names: ['AGENTS.md', 'CLAUDE.md', 'PULL_REQUEST_TEMPLATE.md'] },
] satisfies { iconName: string; names: string[] }[];

const MATERIAL_FILE_PREFIX_RULES = [
  { iconName: 'tune', prefixes: ['.env.'] },
  { iconName: 'eslint', prefixes: ['.eslintrc', 'eslint.config.'] },
  { iconName: 'stylelint', prefixes: ['.stylelintrc', 'stylelint.config.'] },
  { iconName: 'prettier', prefixes: ['.prettierrc', 'prettier.config.'] },
  { iconName: 'commitlint', prefixes: ['.commitlintrc', 'commitlint.config.'] },
  { iconName: 'next', prefixes: ['next.config.'] },
  { iconName: 'vite', prefixes: ['vite.config.'] },
] satisfies { iconName: string; prefixes: string[] }[];

const cssString = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

const cssUrl = (url: string) => `url("${cssString(url)}")`;

const svgMaskUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const iconUrl = (iconsUrl: string, iconName: string, open = false) =>
  `${iconsUrl}/${iconName}${open ? '-open' : ''}.svg`;

const iconBackground = (iconsUrl: string, iconName: string, open = false) =>
  cssUrl(iconUrl(iconsUrl, iconName, open));

const getFolderRowSelectors = (names: string[]) =>
  names
    .flatMap((name) => {
      const escaped = cssString(name);
      return [
        `[data-item-type="folder"][data-item-path="${escaped}/" i]`,
        `[data-item-type="folder"][data-item-path$="/${escaped}/" i]`,
        `[data-item-type="folder"][data-item-path="${escaped}" i]`,
        `[data-item-type="folder"][data-item-path$="/${escaped}" i]`,
      ];
    })
    .join(',\n');

const getFileNameSelectors = (names: string[]) =>
  names
    .flatMap((name) => {
      const escaped = cssString(name);
      return [
        `[data-item-type="file"][data-item-path="${escaped}" i]`,
        `[data-item-type="file"][data-item-path$="/${escaped}" i]`,
      ];
    })
    .join(',\n');

const getFileExtensionSelectors = (extensions: string[]) =>
  extensions
    .map((extension) => {
      const escaped = cssString(extension);
      return `[data-item-type="file"][data-item-path$=".${escaped}" i]`;
    })
    .join(',\n');

const getFilePrefixSelectors = (prefixes: string[]) =>
  prefixes
    .flatMap((prefix) => {
      const escaped = cssString(prefix);
      return [
        `[data-item-type="file"][data-item-path^="${escaped}" i]`,
        `[data-item-type="file"][data-item-path*="/${escaped}" i]`,
      ];
    })
    .join(',\n');

const getFileIconSectionRules = (selectors: string, iconsUrl: string, iconName: string) => `
  ${selectors
    .split(',\n')
    .map((selector) => `${selector} > [data-item-section="icon"]`)
    .join(',\n')} {
    background-image: ${iconBackground(iconsUrl, iconName)};
  }
`;

const getFolderIconRules = (iconsUrl: string) =>
  MATERIAL_FOLDER_ICON_RULES.map(({ iconName, names }) => {
    const selectors = getFolderRowSelectors(names);
    return `
  ${selectors
    .split(',\n')
    .map((selector) => `${selector} [data-item-section="content"]::before`)
    .join(',\n')} {
    background-image: ${iconBackground(iconsUrl, iconName)};
  }
  ${selectors
    .split(',\n')
    .map((selector) => `${selector}[aria-expanded="true"] [data-item-section="content"]::before`)
    .join(',\n')} {
    background-image: ${iconBackground(iconsUrl, iconName, true)};
  }
`;
  }).join('\n');

const getFileIconRules = (iconsUrl: string) => `
${MATERIAL_FILE_EXTENSION_RULES.map(({ extensions, iconName }) =>
  getFileIconSectionRules(getFileExtensionSelectors(extensions), iconsUrl, iconName),
).join('\n')}
${MATERIAL_FILE_NAME_RULES.map(({ iconName, names }) =>
  getFileIconSectionRules(getFileNameSelectors(names), iconsUrl, iconName),
).join('\n')}
${MATERIAL_FILE_PREFIX_RULES.map(({ iconName, prefixes }) =>
  getFileIconSectionRules(getFilePrefixSelectors(prefixes), iconsUrl, iconName),
).join('\n')}
`;

// pierre renders its own <svg> in the file icon slot; we paint the material /
// 文稿 glyph over it, so hide the built-in one.
const HIDE_FILE_SLOT_SVG_CSS = `
  [data-item-type="file"] > [data-item-section="icon"] > svg {
    visibility: hidden;
  }
`;

const getFolderIconCSS = (iconsUrl: string) => `
  [data-item-type="folder"] [data-item-section="content"] {
    display: flex;
    align-items: center;
  }
  [data-item-type="folder"] [data-item-section="content"]::before {
    content: '';
    flex: 0 0 auto;
    width: ${FOLDER_ICON_SIZE};
    height: ${FOLDER_ICON_SIZE};
    margin-inline-end: 4px;
    background-image: ${iconBackground(iconsUrl, 'folder')};
    background-position: center;
    background-repeat: no-repeat;
    background-size: ${FOLDER_ICON_SIZE} ${FOLDER_ICON_SIZE};
  }
  [data-item-type="folder"][aria-expanded="true"] [data-item-section="content"]::before {
    background-image: ${iconBackground(iconsUrl, 'folder', true)};
  }
${getFolderIconRules(iconsUrl)}
`;

// Material file icons keyed off extension / name (js, json, .gitignore, …).
const getMaterialFileIconCSS = (iconsUrl: string) => `
  [data-item-type="file"] > [data-item-section="icon"] {
    margin-inline-start: var(${FILE_ICON_OFFSET_VAR}, 0px);
    background-image: ${iconBackground(iconsUrl, 'file')};
    background-position: center;
    background-repeat: no-repeat;
    background-size: ${FILE_ICON_SIZE} ${FILE_ICON_SIZE};
  }
${HIDE_FILE_SLOT_SVG_CSS}
${getFileIconRules(iconsUrl)}
`;

// Every row in the agent documents tree is a manuscript, so paint the file slot
// with the shared 文稿 glyph (themed, monochrome) instead of extension-specific
// material icons.
const DOCUMENT_FILE_ICON_CSS = `
  [data-item-type="file"] > [data-item-section="icon"] {
    margin-inline-start: var(${FILE_ICON_OFFSET_VAR}, 0px);
    background-color: var(--trees-fg-override, currentColor);
    -webkit-mask-image: ${svgMaskUrl(FILE_TEXT_ICON_SVG)};
    -webkit-mask-position: center;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-size: ${FILE_ICON_SIZE} ${FILE_ICON_SIZE};
    mask-image: ${svgMaskUrl(FILE_TEXT_ICON_SVG)};
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: ${FILE_ICON_SIZE} ${FILE_ICON_SIZE};
  }
${HIDE_FILE_SLOT_SVG_CSS}
`;

export const getExplorerTreeIconCSS = (iconsUrl = MATERIAL_FILE_ICON_ASSETS_URL) => `
${getFolderIconCSS(iconsUrl)}
${getMaterialFileIconCSS(iconsUrl)}
`;

export const FOLDER_ICON_CSS = getExplorerTreeIconCSS();

// Folder rows keep their material icons; file rows use the 文稿 glyph. Used by
// the agent documents tree only — the project Files tree keeps FOLDER_ICON_CSS.
export const DOCUMENT_TREE_ICON_CSS = `
${getFolderIconCSS(MATERIAL_FILE_ICON_ASSETS_URL)}
${DOCUMENT_FILE_ICON_CSS}
`;

// Tree rows are pointer targets, not prose: allowing text selection lets a
// drag-select swallow the row so a subsequent right-click hits the browser's
// native selection menu instead of our context menu. Disable selection on rows
// while keeping the rename input editable.
export const DISABLE_ROW_TEXT_SELECTION_CSS = `
  [data-type='item'] {
    user-select: none;
  }

  [data-type='item'] input {
    user-select: text;
  }
`;

// pierre/trees marks the clicked row as model-focused, which otherwise paints
// a pointer-only ring.
// Keep the native :focus-visible ring for keyboard navigation.
export const HIDE_POINTER_FOCUS_RING_CSS = `
  [data-type='item'][data-item-focused='true']:not(:focus-visible)::before {
    outline: none;
  }

  [data-type='item'][data-item-focused='true']:not(:focus-visible)
    [data-item-flattened-subitems] {
    --truncate-marker-block-inset: 0px;
  }
`;

export const getExplorerTreeStyleVars = ({
  reserveChevronSlot,
}: {
  reserveChevronSlot: boolean;
}): CSSProperties =>
  ({
    [FILE_ICON_OFFSET_VAR]: reserveChevronSlot ? RESERVED_FILE_ICON_OFFSET : '0px',
  }) as CSSProperties;
