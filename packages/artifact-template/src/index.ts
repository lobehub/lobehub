// Shared between the Sandpack preview and the publishable-site builder. This
// package is the single source of truth for React artifact boilerplate,
// dependencies, and runtime aliases.

export interface ReactArtifactPackageJsonOverride {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface ReactArtifactTemplateOverrides {
  appCode?: string;
  entry?: string;
  indexHtml?: string;
  packageJson?: ReactArtifactPackageJsonOverride;
  viteConfig?: string;
}

export interface ReactArtifactTemplateOptions {
  appCode: string;
  extraFiles?: Record<string, string>;
  overrides?: ReactArtifactTemplateOverrides;
  title?: string;
}

export interface ReactArtifactProject {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  entry: string;
  externalResources: readonly string[];
  files: Record<string, string>;
}

// The HTML shell loaded by the browser when visiting the deployed site.
export const REACT_ARTIFACT_ENTRY_PATH = '/index.html';
// The JS bootstrap module the HTML shell references via <script type="module">.
export const REACT_ARTIFACT_BOOTSTRAP_PATH = '/index.tsx';
export const REACT_ARTIFACT_APP_PATH = '/App.tsx';
export const REACT_ARTIFACT_INDEX_HTML_PATH = '/index.html';
export const REACT_ARTIFACT_VITE_CONFIG_PATH = '/vite.config.ts';
export const REACT_ARTIFACT_PACKAGE_JSON_PATH = '/package.json';

export const REACT_ARTIFACT_DEFAULT_DEPENDENCIES: Record<string, string> = {
  '@ant-design/icons': 'latest',
  '@lshay/ui': 'latest',
  '@radix-ui/react-accordion': 'latest',
  '@radix-ui/react-alert-dialog': 'latest',
  '@radix-ui/react-avatar': 'latest',
  '@radix-ui/react-checkbox': 'latest',
  '@radix-ui/react-collapsible': 'latest',
  '@radix-ui/react-dialog': 'latest',
  '@radix-ui/react-dropdown-menu': 'latest',
  '@radix-ui/react-icons': 'latest',
  '@radix-ui/react-label': 'latest',
  '@radix-ui/react-navigation-menu': 'latest',
  '@radix-ui/react-popover': 'latest',
  '@radix-ui/react-progress': 'latest',
  '@radix-ui/react-scroll-area': 'latest',
  '@radix-ui/react-select': 'latest',
  '@radix-ui/react-separator': 'latest',
  '@radix-ui/react-slider': 'latest',
  '@radix-ui/react-slot': 'latest',
  '@radix-ui/react-switch': 'latest',
  '@radix-ui/react-tabs': 'latest',
  '@radix-ui/react-toast': 'latest',
  '@radix-ui/react-tooltip': 'latest',
  'antd': 'latest',
  'class-variance-authority': 'latest',
  'cmdk': 'latest',
  'clsx': 'latest',
  'date-fns': 'latest',
  'embla-carousel-react': 'latest',
  'input-otp': 'latest',
  'lodash-es': 'latest',
  // Pin to 0.x. lucide-react 1.x renamed/dropped several icons (notably
  // `Github` and `Twitter`), but most LLM training data still emits the 0.x
  // names. Until model knowledge catches up, prefer the stable 0.x line.
  'lucide-react': '^0.544.0',
  'motion': 'latest',
  'react': '19.2.7',
  'react-day-picker': 'latest',
  'react-dom': '19.2.7',
  'react-router': 'latest',
  'recharts': 'latest',
  'sonner': 'latest',
  'tailwind-merge': 'latest',
  'vaul': 'latest',
  'zustand': 'latest',
};

export const REACT_ARTIFACT_DEFAULT_DEV_DEPENDENCIES: Record<string, string> = {
  '@types/react': 'latest',
  '@types/react-dom': 'latest',
  // The preview runs inside Sandpack's Nodebox, which emulates Node 16 and cannot load
  // native bindings. Vite 5+ requires Node 18/20+ and Vite 8 bundles rolldown (native),
  // so `latest` breaks the sandbox ("Cannot find native binding", "Vite requires Node.js
  // 20.19+"). Mirror the pins of Sandpack's own `vite-react-ts` template: Vite 4 plus
  // `esbuild-wasm`, which Nodebox substitutes for the native esbuild binary.
  '@vitejs/plugin-react': '^4.3.4',
  'esbuild-wasm': '^0.17.12',
  'typescript': 'latest',
  'vite': '4.2.0',
  // Babel presets used instead of esbuild for TS/JSX — see `defaultViteConfig` for why.
  '@babel/preset-react': '^7.26.3',
  '@babel/preset-typescript': '^7.26.0',
};

/**
 * Bare module specifiers that must always be pre-bundled: they are imported by the
 * bootstrap entry / injected by `@vitejs/plugin-react`, so Vite needs them regardless of
 * what the artifact itself imports.
 */
const REACT_ARTIFACT_CORE_OPTIMIZE_DEPS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
];

// Static `import`/`export ... from` statements only; dynamic `import()` calls are left to
// Vite's runtime dependency discovery.
const IMPORT_SPECIFIER_RE = /\b(?:import|export)\b(?:[^'"]+?\bfrom)?\s*['"]([^'"]+)['"]/g;

/**
 * Collect the bare package specifiers imported by the artifact source so they can be
 * listed in `optimizeDeps.include`. Relative and absolute paths are skipped; alias
 * prefixes are mapped to their real package target.
 */
export const collectArtifactBareImports = (appCode: string): string[] => {
  const specifiers = new Set<string>();

  for (const match of appCode.matchAll(IMPORT_SPECIFIER_RE)) {
    let specifier = match[1];
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;

    for (const [alias, target] of Object.entries(REACT_ARTIFACT_VITE_ALIASES)) {
      if (specifier === alias || specifier.startsWith(`${alias}/`)) {
        specifier = target + specifier.slice(alias.length);
        break;
      }
    }

    // Unresolved aliases (e.g. `@/lib/utils`) are not packages.
    if (specifier.startsWith('@/')) continue;

    specifiers.add(specifier);
  }

  return [...specifiers];
};

export const REACT_ARTIFACT_TAILWIND_CDN = 'https://cdn.tailwindcss.com';
export const REACT_ARTIFACT_EXTERNAL_RESOURCES: readonly string[] = [REACT_ARTIFACT_TAILWIND_CDN];

export const REACT_ARTIFACT_VITE_ALIASES: Record<string, string> = {
  '@/components/ui': '@lshay/ui/components/default',
};

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const defaultIndexHtml = (title: string) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <script src="${REACT_ARTIFACT_TAILWIND_CDN}"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/index.tsx"></script>
  </body>
</html>
`;

const defaultEntry = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

// Why this config avoids esbuild for the artifact source:
//
// In the Sandpack preview, Vite runs inside Nodebox, where `esbuild-wasm` runs as an
// emulated child process talking to Vite over an emulated stdio pipe. Any single message
// Vite sends to that child larger than 16 KiB desyncs the esbuild protocol and the
// service hangs forever — every transform after that times out and the preview stays
// blank. Two code paths push the raw `App.tsx` through that pipe:
//   1. the `vite:esbuild` TS/JSX transform plugin, and
//   2. the dependency scanner (`optimizeDeps.entries` crawl), which feeds entry sources
//      to esbuild via `onLoad`.
// Real artifacts easily exceed 16 KiB, so both are switched off: `@vitejs/plugin-react`
// compiles TS/JSX with Babel in-process, and `optimizeDeps` gets an explicit `include`
// list (derived from the artifact's imports) with no entry crawl. Pre-bundling itself is
// safe because esbuild reads `node_modules` and writes output on its own side of the pipe.
//
// `esbuild: false` must be re-applied by a trailing plugin because `@vitejs/plugin-react`'s
// `config()` hook returns an `esbuild: { jsx: ... }` object that overrides the user value.
const defaultViteConfig = (
  optimizeDepsInclude: string[],
) => `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  esbuild: false,
  optimizeDeps: {
    entries: [],
    include: ${JSON.stringify(optimizeDepsInclude, null, 6)},
  },
  plugins: [
    react({
      babel: {
        presets: ['@babel/preset-typescript', ['@babel/preset-react', { runtime: 'automatic' }]],
      },
    }),
    { name: 'lobe-artifact:disable-esbuild', enforce: 'post', config: () => ({ esbuild: false }) },
  ],
  resolve: {
    alias: ${JSON.stringify(REACT_ARTIFACT_VITE_ALIASES, null, 6)},
  },
});
`;

const defaultPackageJson = (
  title: string,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
) =>
  `${JSON.stringify(
    {
      name: 'lobe-artifact-react-app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        build: 'vite build',
        dev: 'vite',
        preview: 'vite preview',
      },
      description: title,
      dependencies,
      devDependencies,
    },
    null,
    2,
  )}\n`;

export const buildReactArtifactProject = (
  options: ReactArtifactTemplateOptions,
): ReactArtifactProject => {
  const { appCode, extraFiles, overrides, title } = options;
  const resolvedTitle = title ?? 'Artifacts App';

  const dependencies = {
    ...REACT_ARTIFACT_DEFAULT_DEPENDENCIES,
    ...overrides?.packageJson?.dependencies,
  };
  const devDependencies = {
    ...REACT_ARTIFACT_DEFAULT_DEV_DEPENDENCIES,
    ...overrides?.packageJson?.devDependencies,
  };

  const resolvedAppCode = overrides?.appCode ?? appCode;
  const optimizeDepsInclude = [
    ...new Set([
      ...REACT_ARTIFACT_CORE_OPTIMIZE_DEPS,
      ...collectArtifactBareImports(resolvedAppCode),
    ]),
  ];

  const files: Record<string, string> = {
    [REACT_ARTIFACT_APP_PATH]: resolvedAppCode,
    [REACT_ARTIFACT_BOOTSTRAP_PATH]: overrides?.entry ?? defaultEntry,
    [REACT_ARTIFACT_INDEX_HTML_PATH]: overrides?.indexHtml ?? defaultIndexHtml(resolvedTitle),
    [REACT_ARTIFACT_PACKAGE_JSON_PATH]: defaultPackageJson(
      resolvedTitle,
      dependencies,
      devDependencies,
    ),
    [REACT_ARTIFACT_VITE_CONFIG_PATH]:
      overrides?.viteConfig ?? defaultViteConfig(optimizeDepsInclude),
  };

  if (extraFiles) {
    for (const [path, content] of Object.entries(extraFiles)) {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      files[normalized] = content;
    }
  }

  return {
    dependencies,
    devDependencies,
    entry: REACT_ARTIFACT_ENTRY_PATH,
    externalResources: REACT_ARTIFACT_EXTERNAL_RESOURCES,
    files,
  };
};
