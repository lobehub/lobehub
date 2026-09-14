import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertSpaTemplateAssets,
  assertSpaTemplatesMatchDist,
  collectSpaAssetReferences,
  readGeneratedSpaTemplates,
} from './spaAssetValidation';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('SPA template asset validation', () => {
  it('finds local asset references across desktop/auth variants', () => {
    expect(
      collectSpaAssetReferences(
        '<script src="/_spa/assets/index-new.js"></script><link href="/_spa-auth/assets/auth.css">',
      ),
    ).toEqual(['/_spa/assets/index-new.js', '/_spa-auth/assets/auth.css']);
    expect(collectSpaAssetReferences('https://cdn.example/_spa/assets/external.js')).toEqual([]);
    expect(collectSpaAssetReferences('//cdn.example/_spa/assets/external.js')).toEqual([]);
  });

  it('fails before Next build when a generated template carries a stale hash', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spa-asset-validation-'));
    roots.push(root);
    mkdirSync(path.join(root, 'public/_spa/assets'), { recursive: true });
    writeFileSync(path.join(root, 'public/_spa/assets/index-current.js'), 'export {};');

    expect(() =>
      assertSpaTemplateAssets(root, [
        {
          name: 'spaHtmlTemplates.ts',
          source: '<script src="/_spa/assets/index-stale.js"></script>',
        },
      ]),
    ).toThrow(/index-stale\.js/);
  });

  it('accepts the exact copied files referenced by the generated template', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spa-asset-validation-'));
    roots.push(root);
    mkdirSync(path.join(root, 'public/_spa/assets'), { recursive: true });
    writeFileSync(path.join(root, 'public/_spa/assets/index-current.js'), 'export {};');

    expect(
      assertSpaTemplateAssets(root, [
        {
          name: 'spaHtmlTemplates.ts',
          source: '<script src="/_spa/assets/index-current.js"></script>',
        },
      ]),
    ).toMatchObject({ missing: [], references: 1 });
  });

  it('requires desktop/auth public roots when their generated templates exist', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spa-asset-validation-'));
    roots.push(root);
    mkdirSync(path.join(root, 'src/app/spa/[variants]/[[...path]]'), { recursive: true });
    mkdirSync(path.join(root, 'src/app/spa-auth'), { recursive: true });
    writeFileSync(
      path.join(root, 'src/app/spa/[variants]/[[...path]]/spaHtmlTemplates.ts'),
      'src="/_spa/assets/desktop.js"',
    );
    writeFileSync(
      path.join(root, 'src/app/spa-auth/authHtmlTemplate.ts'),
      'src="/_spa-auth/assets/auth.js"',
    );
    expect(() => assertSpaTemplateAssets(root, readGeneratedSpaTemplates(root))).toThrow(
      /desktop\.js/,
    );
  });

  it('rejects a generated template whose asset set differs from current dist HTML', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spa-asset-validation-'));
    roots.push(root);
    const templatePath = path.join(root, 'src/app/spa/[variants]/[[...path]]');
    mkdirSync(templatePath, { recursive: true });
    mkdirSync(path.join(root, 'public/_spa/assets'), { recursive: true });
    mkdirSync(path.join(root, 'dist/desktop'), { recursive: true });
    writeFileSync(
      path.join(templatePath, 'spaHtmlTemplates.ts'),
      'src="/_spa/assets/index-old.js"',
    );
    writeFileSync(path.join(root, 'public/_spa/assets/index-new.js'), 'export {};');
    writeFileSync(
      path.join(root, 'dist/desktop/index.html'),
      '<script src="/_spa/assets/index-new.js">',
    );

    expect(() =>
      assertSpaTemplatesMatchDist(root, [
        {
          name: 'src/app/spa/[variants]/[[...path]]/spaHtmlTemplates.ts',
          source: 'src="/_spa/assets/index-old.js"',
        },
      ]),
    ).toThrow(/staleInTemplate/);
  });

  it('uses the mobile index.html fallback when index.mobile.html is absent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'spa-asset-validation-'));
    roots.push(root);
    mkdirSync(path.join(root, 'public/_spa/assets'), { recursive: true });
    mkdirSync(path.join(root, 'dist/mobile'), { recursive: true });
    writeFileSync(path.join(root, 'public/_spa/assets/mobile.js'), 'export {};');
    writeFileSync(
      path.join(root, 'dist/mobile/index.html'),
      '<script src="/_spa/assets/mobile.js">',
    );

    expect(() =>
      assertSpaTemplatesMatchDist(root, [
        {
          name: 'src/app/spa/[variants]/[[...path]]/spaHtmlTemplates.ts',
          source: 'src="/_spa/assets/mobile.js"',
        },
      ]),
    ).not.toThrow();
  });
});
