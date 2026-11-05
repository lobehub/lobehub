import { cp } from 'node:fs/promises';

// Keep a compatibility copy for released clients while new callers use /static/app-images.
await cp('public/static/app-images', 'public/app-images', { recursive: true });
