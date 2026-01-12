import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

export default defineConfig({
    plugins: [tsconfigPaths()],
    resolve: {
        alias: [
            { find: '@', replacement: path.resolve(__dirname, 'src') },
            { find: /^@\/(.*)/, replacement: path.resolve(__dirname, 'src') + '/$1' },
        ],
    },
    test: {
        globals: true,
        environment: 'jsdom',
    },
});
