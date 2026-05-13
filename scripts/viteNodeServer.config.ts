import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    {
      name: 'lobe-vite-node-raw-md',
      load(id) {
        const [filepath] = id.split('?');
        if (!filepath.endsWith('.md')) return;

        return `export default ${JSON.stringify(readFileSync(filepath, 'utf8'))};`;
      },
    },
    tsconfigPaths(),
  ],
});
