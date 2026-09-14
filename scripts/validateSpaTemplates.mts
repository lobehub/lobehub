import path from 'node:path';

import {
  assertSpaTemplateAssets,
  assertSpaTemplatesMatchDist,
  readGeneratedSpaTemplates,
} from './spaAssetValidation';

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(import.meta.dirname, '..');
const templates = readGeneratedSpaTemplates(root);
if (templates.length === 0) throw new Error('No generated SPA templates found.');

const result = assertSpaTemplateAssets(root, templates);
assertSpaTemplatesMatchDist(root, templates);
console.log(`[spa-assets] validated ${result.references} local template references`);
