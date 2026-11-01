import { createRequire } from 'node:module';
import path from 'node:path';

// Reuse electron-builder's installed ASAR implementation.
const require = createRequire(import.meta.url);
const builder = createRequire(
  createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'),
);
const { createPackageWithOptions } = builder('@electron/asar');

export async function packBuiltinCore(desktopDir) {
  await createPackageWithOptions(
    path.join(desktopDir, 'core-dist'),
    path.join(desktopDir, 'core.asar'),
    { unpackDir: 'cli' },
  );
}
