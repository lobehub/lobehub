/* eslint-disable no-undef */
import { Lang, parse } from '@ast-grep/napi';
import fs from 'fs-extra';
import path from 'node:path';

import { invariant, isDirectRun, runStandalone, updateFile, writeFileEnsuring } from './utils.mjs';

interface I18nMetadata {
  defaultLang: string;
  locales: string[];
  namespaces: string[];
}

type CodeEdit = { end: number; start: number; text: string };

const toIdentifier = (value: string) => value.replaceAll(/\W/g, '_');

const extractDefaultLang = (code: string): string => {
  const match = code.match(/export const DEFAULT_LANG = '([^']+)'/);
  if (!match) throw new Error('[convertI18nDynamicToStatic] Failed to extract DEFAULT_LANG');
  return match[1];
};

const extractLocales = (code: string): string[] => {
  const match = code.match(/export const locales = \[([\S\s]*?)] as const;/);
  if (!match) throw new Error('[convertI18nDynamicToStatic] Failed to extract locales array');

  const locales: string[] = [];
  const regex = /'([^']+)'/g;
  let result: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((result = regex.exec(match[1])) !== null) {
    locales.push(result[1]);
  }

  invariant(locales.length > 0, '[convertI18nDynamicToStatic] No locales found');
  return locales;
};

const extractNamespaces = (code: string): string[] => {
  const match = code.match(/const resources = {([\S\s]*?)} as const;/);
  if (!match)
    throw new Error('[convertI18nDynamicToStatic] Failed to extract default resources map');

  const namespaces = new Set<string>();

  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    const withoutComma = line.replace(/,$/, '').trim();

    if (withoutComma.includes(':')) {
      const keyPart = withoutComma.split(':')[0].trim();
      const keyMatch = keyPart.match(/^'([^']+)'$/);
      if (keyMatch) namespaces.add(keyMatch[1]);
      continue;
    }

    const identifierMatch = withoutComma.match(/^(\w+)$/);
    if (identifierMatch) namespaces.add(identifierMatch[1]);
  }

  invariant(namespaces.size > 0, '[convertI18nDynamicToStatic] No namespaces found');
  return [...namespaces].sort();
};

const loadI18nMetadata = async (TEMP_DIR: string): Promise<I18nMetadata> => {
  const defaultLangPath = path.join(TEMP_DIR, 'src/const/locale.ts');
  const localesPath = path.join(TEMP_DIR, 'src/locales/resources.ts');
  const defaultResourcesPath = path.join(TEMP_DIR, 'src/locales/default/index.ts');

  const [defaultLangCode, localesCode, defaultResourcesCode] = await Promise.all([
    fs.readFile(defaultLangPath, 'utf8'),
    fs.readFile(localesPath, 'utf8'),
    fs.readFile(defaultResourcesPath, 'utf8'),
  ]);

  const defaultLang = extractDefaultLang(defaultLangCode);
  const locales = extractLocales(localesCode);
  const namespaces = extractNamespaces(defaultResourcesCode);

  return { defaultLang, locales, namespaces };
};

const generateLocaleNamespaceImports = (metadata: I18nMetadata) => {
  const importLines: string[] = [];
  const localeEntries: string[] = [];

  for (const locale of metadata.locales) {
    if (locale === metadata.defaultLang) continue;

    const namespaceEntries: string[] = [];

    for (const ns of metadata.namespaces) {
      const alias = `locale_${toIdentifier(locale)}__${toIdentifier(ns)}`;
      importLines.push(`import ${alias} from '@/../locales/${locale}/${ns}.json';`);
      namespaceEntries.push(`    '${ns}': { default: ${alias} },`);
    }

    localeEntries.push(`  '${locale}': {\n${namespaceEntries.join('\n')}\n  },`);
  }

  return {
    imports: importLines.join('\n'),
    localeEntries: localeEntries.join('\n'),
  };
};

const generateBusinessUiImports = (metadata: I18nMetadata) => {
  const importLines: string[] = [];
  const mapEntries: string[] = [];

  for (const locale of metadata.locales) {
    const alias = `ui_${toIdentifier(locale)}`;
    importLines.push(`import ${alias} from '@/../locales/${locale}/ui.json';`);
    mapEntries.push(`  '${locale}': ${alias} as UILocaleResources,`);
  }

  return {
    imports: importLines.join('\n'),
    mapEntries: mapEntries.join('\n'),
  };
};

const buildElectronI18nMapContent = (metadata: I18nMetadata) => {
  const { imports, localeEntries } = generateLocaleNamespaceImports(metadata);

  return `import defaultResources from '@/locales/default';

${imports}

export type LocaleNamespaceModule = { default: unknown };

const toModule = (resource: unknown): LocaleNamespaceModule => ({ default: resource });

export const defaultNamespaceModules: Record<string, LocaleNamespaceModule> = Object.fromEntries(
  Object.entries(defaultResources).map(([ns, resource]) => [ns, toModule(resource)]),
);

export const getDefaultNamespaceModule = (ns: string): LocaleNamespaceModule => {
  const resource = defaultResources[ns as keyof typeof defaultResources] ?? defaultResources.common;
  return toModule(resource);
};

export const staticLocaleNamespaceMap: Record<string, Record<string, LocaleNamespaceModule>> = {
  '${metadata.defaultLang}': defaultNamespaceModules,
${localeEntries}
};
`;
};

const buildElectronUiResourcesContent = (metadata: I18nMetadata) => {
  const { imports, mapEntries } = generateBusinessUiImports(metadata);

  return `${imports}

export type UILocaleResources = Record<string, Record<string, string>>;

export const businessUiResources: Record<string, UILocaleResources> = {
${mapEntries}
};
`;
};

const applyEdits = (code: string, edits: CodeEdit[]): string => {
  if (edits.length === 0) return code;

  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = code;

  for (const edit of sorted) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }

  return result;
};

const ensureImportAfterLastImport = (code: string, importStatement: string): string => {
  if (code.includes(importStatement)) return code;

  const moduleMatch = importStatement.match(/from '([^']+)'/);
  if (moduleMatch) {
    const modulePath = moduleMatch[1];
    const hasModuleImport = new RegExp(`from ['"]${modulePath}['"]`).test(code);
    if (hasModuleImport) return code;
  }

  const ast = parse(Lang.TypeScript, code);
  const root = ast.root();
  const imports = root.findAll({ rule: { kind: 'import_statement' } });
  if (imports.length === 0) {
    return `${importStatement}\n\n${code}`;
  }

  const lastImport = imports.at(-1)!;
  const insertPos = lastImport.range().end.index;

  return code.slice(0, insertPos) + `\n${importStatement}` + code.slice(insertPos);
};

const transformLoadNamespaceModule = (code: string) => {
  const importStatement =
    "import { defaultNamespaceModules, getDefaultNamespaceModule, staticLocaleNamespaceMap } from '@/utils/i18n/__electronI18nMap';";

  let result = ensureImportAfterLastImport(code, importStatement);

  const ast = parse(Lang.TypeScript, result);
  const root = ast.root();

  const edits: CodeEdit[] = [];

  const defaultLangReturns = root.findAll({
    rule: {
      pattern: 'if (lng === defaultLang) return import(`@/locales/default/${ns}`);',
    },
  });

  for (const node of defaultLangReturns) {
    const range = node.range();
    edits.push({
      end: range.end.index,
      start: range.start.index,
      text: 'if (lng === defaultLang) return defaultNamespaceModules[ns] ?? getDefaultNamespaceModule(ns);',
    });
  }

  const dynamicLocaleReturns = root.findAll({
    rule: {
      pattern: 'return import(`@/../locales/${normalizeLocale(lng)}/${ns}.json`);',
    },
  });

  for (const node of dynamicLocaleReturns) {
    const range = node.range();
    edits.push({
      end: range.end.index,
      start: range.start.index,
      text: 'return staticLocaleNamespaceMap[normalizeLocale(lng)]?.[ns] ?? getDefaultNamespaceModule(ns);',
    });
  }

  const defaultFallbackReturns = root.findAll({
    rule: {
      pattern: 'return import(`@/locales/default/${ns}`);',
    },
  });

  for (const node of defaultFallbackReturns) {
    const range = node.range();
    edits.push({
      end: range.end.index,
      start: range.start.index,
      text: 'return getDefaultNamespaceModule(ns);',
    });
  }

  result = applyEdits(result, edits);

  // Fallback to robust function-level replacements if AST patterns did not match.
  result = result.replace(
    /export const loadI18nNamespaceModule = async[\S\s]*?};/m,
    `export const loadI18nNamespaceModule = async (params: LoadI18nNamespaceModuleParams) => {
  const { defaultLang, normalizeLocale, lng, ns } = params;

  if (lng === defaultLang) return defaultNamespaceModules[ns] ?? getDefaultNamespaceModule(ns);

  try {
    const normalizedLocale = normalizeLocale(lng);
    const localeResources = staticLocaleNamespaceMap[normalizedLocale];

    if (localeResources?.[ns]) return localeResources[ns];

    return defaultNamespaceModules[ns] ?? getDefaultNamespaceModule(ns);
  } catch {
    return getDefaultNamespaceModule(ns);
  }
};`,
  );
  result = result.replace(
    /export const loadI18nNamespaceModuleWithFallback = async[\S\s]*?};/m,
    `export const loadI18nNamespaceModuleWithFallback = async (
  params: LoadI18nNamespaceModuleWithFallbackParams,
) => {
  const { onFallback, ...rest } = params;

  try {
    return await loadI18nNamespaceModule(rest);
  } catch (error) {
    onFallback?.({ error, lng: rest.lng, ns: rest.ns });
    return getDefaultNamespaceModule(rest.ns);
  }
};`,
  );

  result = result.replaceAll(/\n{3,}/g, '\n\n');

  return result;
};

const replaceFunctionBody = (code: string, functionName: string, newBody: string): string => {
  const ast = parse(Lang.TypeScript, code);
  const root = ast.root();

  const target = root.find({
    rule: {
      kind: 'variable_declarator',
      pattern: `const ${functionName} = $EXPR`,
    },
  });

  if (!target) return code;

  const declaratorText = target.text();
  const initMatch = declaratorText.match(/=\s*([\S\s]*)$/);
  if (!initMatch) return code;

  const initText = initMatch[1];
  const initStart = declaratorText.indexOf(initText);
  if (initStart < 0) return code;

  const fullRange = target.range();
  const initRange = {
    end: fullRange.start.index + initStart + initText.length,
    start: fullRange.start.index + initStart,
  };

  const updated = code.slice(0, initRange.start) + newBody + code.slice(initRange.end);
  return updated;
};

const transformUiLocaleResources = (code: string) => {
  const uiImportStatement = "import { en, zhCn } from '@lobehub/ui/es/i18n/resources/index';";
  const businessImportStatement =
    "import { businessUiResources } from '@/libs/__electronUiResources';";

  let result = ensureImportAfterLastImport(code, uiImportStatement);
  result = ensureImportAfterLastImport(result, businessImportStatement);

  result = replaceFunctionBody(
    result,
    'loadBusinessResources',
    `(locale: string): UILocaleResources | null => {
  return businessUiResources[locale] ?? null;
}`,
  );

  result = replaceFunctionBody(
    result,
    'loadLobeUIBuiltinResources',
    `(locale: string): UILocaleResources | null => {
  if (locale.startsWith('zh')) return zhCn as UILocaleResources;
  return en as UILocaleResources;
}`,
  );

  // Fallback to string replacements if AST patterns did not match.
  result = result.replace(
    /const loadBusinessResources = async[\S\s]*?};/m,
    `const loadBusinessResources = (locale: string): UILocaleResources | null => {
  return businessUiResources[locale] ?? null;
};`,
  );
  result = result.replace(
    /const loadLobeUIBuiltinResources = async[\S\s]*?};/m,
    `const loadLobeUIBuiltinResources = (locale: string): UILocaleResources | null => {
  if (locale.startsWith('zh')) return zhCn as UILocaleResources;
  return en as UILocaleResources;
};`,
  );

  result = result.replaceAll(/\n{3,}/g, '\n\n');

  return result;
};

export const convertI18nDynamicToStatic = async (TEMP_DIR: string) => {
  console.log('  Converting i18n dynamic imports to static maps...');

  const metadata = await loadI18nMetadata(TEMP_DIR);

  const electronI18nMapPath = path.join(TEMP_DIR, 'src/utils/i18n/__electronI18nMap.ts');
  const electronUiResourcesPath = path.join(TEMP_DIR, 'src/libs/__electronUiResources.ts');
  const loadNamespacePath = path.join(TEMP_DIR, 'src/utils/i18n/loadI18nNamespaceModule.ts');
  const uiLocalePath = path.join(TEMP_DIR, 'src/libs/getUILocaleAndResources.ts');

  await fs.ensureFile(electronI18nMapPath);
  await fs.ensureFile(electronUiResourcesPath);

  await writeFileEnsuring({
    assertAfter: (code) => !code.includes('import(`'),
    filePath: electronI18nMapPath,
    name: 'convertI18nDynamicToStatic.electronI18nMap',
    text: buildElectronI18nMapContent(metadata),
  });

  await writeFileEnsuring({
    assertAfter: (code) => !code.includes('await import('),
    filePath: electronUiResourcesPath,
    name: 'convertI18nDynamicToStatic.electronUiResources',
    text: buildElectronUiResourcesContent(metadata),
  });

  await updateFile({
    assertAfter: (code) =>
      code.includes('@/utils/i18n/__electronI18nMap') &&
      !code.includes('import(`@/locales/default/${ns}`)') &&
      !code.includes('import(`@/locales/default/${rest.ns}`)') &&
      !code.includes('import(`@/../locales/${normalizeLocale(lng)}/${ns}.json`)'),
    filePath: loadNamespacePath,
    name: 'convertI18nDynamicToStatic.loadNamespace',
    transformer: transformLoadNamespaceModule,
  });

  await updateFile({
    assertAfter: (code) =>
      code.includes('@/libs/__electronUiResources') &&
      code.includes('@lobehub/ui/es/i18n/resources/index') &&
      !code.includes('await import(`@/../locales/${locale}/ui.json`)') &&
      !code.includes("await import('@lobehub/ui/es/i18n/resources/index')"),
    filePath: uiLocalePath,
    name: 'convertI18nDynamicToStatic.uiLocale',
    transformer: transformUiLocaleResources,
  });
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('convertI18nDynamicToStatic', convertI18nDynamicToStatic, []);
}
