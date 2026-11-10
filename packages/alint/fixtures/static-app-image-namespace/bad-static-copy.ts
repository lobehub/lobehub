import { cp } from 'node:fs/promises';

// Package the current fixed product images for the renderer.
// alint-expect
await cp('public/static/app-images', 'dist/renderer/app-images', { recursive: true });
