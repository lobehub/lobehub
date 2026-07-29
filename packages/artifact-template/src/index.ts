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
  '@vitejs/plugin-react': 'latest',
  'typescript': 'latest',
  'vite': 'latest',
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

const defaultViteConfig = `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
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

  const files: Record<string, string> = {
    [REACT_ARTIFACT_APP_PATH]: overrides?.appCode ?? appCode,
    [REACT_ARTIFACT_BOOTSTRAP_PATH]: overrides?.entry ?? defaultEntry,
    [REACT_ARTIFACT_INDEX_HTML_PATH]: overrides?.indexHtml ?? defaultIndexHtml(resolvedTitle),
    [REACT_ARTIFACT_PACKAGE_JSON_PATH]: defaultPackageJson(
      resolvedTitle,
      dependencies,
      devDependencies,
    ),
    [REACT_ARTIFACT_VITE_CONFIG_PATH]: overrides?.viteConfig ?? defaultViteConfig,
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
