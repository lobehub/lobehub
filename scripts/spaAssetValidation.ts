import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveShareHtmlPath, resolveWorkbenchHtmlPath } from './spaHtmlPaths';

export interface SpaTemplateSource {
  name: string;
  source: string;
}

export interface SpaAssetValidationResult {
  missing: Array<{ reference: string; path: string; source: string }>;
  references: number;
}

const LOCAL_SPA_REFERENCE =
  /(?<![\w+.:/-])\/(?:_spa-auth|_spa-workbench|_spa-share|_spa)\/[^\s"'\\<>)]+/g;

const normalizeReference = (reference: string): string => {
  const withoutQuery = reference.split(/[?#]/u, 1)[0] ?? reference;
  return withoutQuery.replace(/[),.;]+$/u, '');
};

export const collectSpaAssetReferences = (source: string): string[] =>
  [
    ...new Set(
      [...source.matchAll(LOCAL_SPA_REFERENCE)].map((match) => normalizeReference(match[0])),
    ),
  ].filter((reference) => reference.length > 0);

export const validateSpaTemplateAssets = (
  root: string,
  templates: readonly SpaTemplateSource[],
): SpaAssetValidationResult => {
  const missing: SpaAssetValidationResult['missing'] = [];
  let references = 0;

  for (const template of templates) {
    for (const reference of collectSpaAssetReferences(template.source)) {
      references += 1;
      const prefix = reference.match(/^\/(?:_spa-auth|_spa-workbench|_spa-share|_spa)/u)?.[0];
      if (!prefix) continue;
      const relativeAsset = reference.slice(prefix.length).replace(/^\/+/, '');
      const assetPath = path.resolve(root, 'public', prefix.slice(1), relativeAsset);
      if (!existsSync(assetPath))
        missing.push({ path: assetPath, reference, source: template.name });
    }
  }

  return { missing, references };
};

export const assertSpaTemplateAssets = (
  root: string,
  templates: readonly SpaTemplateSource[],
): SpaAssetValidationResult => {
  const result = validateSpaTemplateAssets(root, templates);
  if (result.missing.length > 0) {
    const details = result.missing
      .slice(0, 20)
      .map(({ path: assetPath, reference, source }) => `${source}: ${reference} -> ${assetPath}`)
      .join('\n');
    throw new Error(
      `SPA template references ${result.missing.length} missing local assets. ` +
        `Run the matching copy/template step before Next build.\n${details}`,
    );
  }
  return result;
};

const templatePaths = [
  {
    publicDir: 'public/_spa',
    relativePath: 'src/app/spa/[variants]/[[...path]]/spaHtmlTemplates.ts',
    required: true,
  },
  {
    publicDir: 'public/_spa-auth',
    relativePath: 'src/app/spa-auth/authHtmlTemplate.ts',
    required: true,
  },
  {
    publicDir: 'public/_spa-workbench',
    relativePath: 'src/app/spa-workbench/workbenchHtmlTemplate.ts',
    required: false,
  },
  {
    publicDir: 'public/_spa-share',
    relativePath: 'src/app/spa-share/shareHtmlTemplate.ts',
    required: false,
  },
] as const;

export const readGeneratedSpaTemplates = (root: string): SpaTemplateSource[] =>
  templatePaths.flatMap(({ publicDir, relativePath }) => {
    const absolutePath = path.resolve(root, relativePath);
    // Workbench/share are optional builds. If their public asset root is
    // absent/empty, do not validate a stale source template from an older
    // optional build; when the build is present its copied assets are the
    // guard's source of truth.
    const entry = templatePaths.find((candidate) => candidate.relativePath === relativePath);
    if (!existsSync(absolutePath)) {
      if (entry?.relativePath === relativePath && entry.required) {
        throw new Error(`Missing required generated SPA template: ${relativePath}`);
      }
      return [];
    }
    if (!entry?.required && !existsSync(path.resolve(root, publicDir, 'assets'))) {
      return [];
    }
    return [{ name: relativePath, source: readFileSync(absolutePath, 'utf8') }];
  });

const unionReferences = (sources: readonly string[]): Set<string> =>
  new Set(sources.flatMap(collectSpaAssetReferences));

/** Ensure a generated source template belongs to the current Vite dist set. */
export const assertSpaTemplatesMatchDist = (
  root: string,
  templates: readonly SpaTemplateSource[],
): void => {
  const distPairs: Array<{ distHtml: string[]; template: string }> = [
    {
      distHtml: ['dist/desktop/index.html'],
      template: 'src/app/spa/[variants]/[[...path]]/spaHtmlTemplates.ts',
    },
    { distHtml: ['dist/auth/index.auth.html'], template: 'src/app/spa-auth/authHtmlTemplate.ts' },
  ];

  const mobileHtml = ['dist/mobile/index.mobile.html', 'dist/mobile/index.html'].find((file) =>
    existsSync(path.resolve(root, file)),
  );
  if (mobileHtml) {
    distPairs[0].distHtml.push(mobileHtml);
  }
  const workbenchHtml = resolveWorkbenchHtmlPath(root);
  if (workbenchHtml) {
    distPairs.push({
      distHtml: [workbenchHtml],
      template: 'src/app/spa-workbench/workbenchHtmlTemplate.ts',
    });
  }
  const shareHtml = resolveShareHtmlPath(root);
  if (shareHtml) {
    distPairs.push({
      distHtml: [shareHtml],
      template: 'src/app/spa-share/shareHtmlTemplate.ts',
    });
  }

  for (const pair of distPairs) {
    const template = templates.find((entry) => entry.name === pair.template);
    const distFiles = pair.distHtml
      .map((relativePath) => path.resolve(root, relativePath))
      .filter(existsSync);
    if (!template || distFiles.length === 0) continue;

    const expected = unionReferences(distFiles.map((file) => readFileSync(file, 'utf8')));
    const actual = new Set(collectSpaAssetReferences(template.source));
    const missingFromTemplate = [...expected].filter((reference) => !actual.has(reference));
    const staleInTemplate = [...actual].filter((reference) => !expected.has(reference));
    if (missingFromTemplate.length > 0 || staleInTemplate.length > 0) {
      throw new Error(
        `Generated SPA template does not match current dist HTML: ${pair.template}\n` +
          `missingFromTemplate=${missingFromTemplate.slice(0, 10).join(',')}\n` +
          `staleInTemplate=${staleInTemplate.slice(0, 10).join(',')}`,
      );
    }
  }
};
