/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RELEASE_DIR = 'build/Release';

// Whether an addon's wrapper stays external (loaded from its package dir) or
// gets inlined into the app bundle depends on the bundler's workspace
// resolution, which has proven unstable across invocation paths — so loading
// must work in both shapes: `dirname` for the external case, and the
// asar-unpacked absolute path for the inlined-in-packaged-app case.
const candidateDirs = (packageName, dirname) => {
  const dirs = [path.join(dirname, RELEASE_DIR)];
  if (process.resourcesPath) {
    dirs.push(
      path.join(process.resourcesPath, 'app.asar.unpacked/node_modules', packageName, RELEASE_DIR),
    );
  }
  return dirs;
};

const findNodeBinary = (dir) => {
  try {
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.node'))
      .map((file) => path.join(dir, file));
  } catch {
    return [];
  }
};

const loadNativeBinding = ({ dirname, packageName }) => {
  const errors = [];
  for (const dir of candidateDirs(packageName, dirname)) {
    const binaries = findNodeBinary(dir);
    if (binaries.length === 0) {
      errors.push(`${dir}: no .node binary`);
      continue;
    }
    for (const binary of binaries) {
      try {
        return require(binary);
      } catch (error) {
        errors.push(`${binary}: ${error.message}`);
      }
    }
  }
  console.error(`[napi-loader] failed to load ${packageName}:`, errors.join('; '));
  return null;
};

module.exports = { loadNativeBinding };
