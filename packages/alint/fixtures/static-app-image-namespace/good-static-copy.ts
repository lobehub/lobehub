import { cp } from 'node:fs/promises';

await cp('public/static/app-images', 'dist/renderer/static/app-images', { recursive: true });
