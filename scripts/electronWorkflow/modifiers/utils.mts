import { Lang, parse } from '@ast-grep/napi';
import fs from 'fs-extra';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface ValidationTarget {
  lang: Lang;
  path: string;
}

interface UpdateFileOptions {
  assertAfter?: (code: string) => boolean;
  filePath: string;
  name: string;
  transformer: (code: string) => string;
}

interface WriteFileOptions {
  assertAfter?: (code: string) => boolean;
  filePath: string;
  name: string;
  text: string;
}

interface RemovePathOptions {
  name: string;
  path: string;
  requireExists?: boolean;
}

export const invariant = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

export const normalizeEol = (code: string) => code.replaceAll('\r\n', '\n');

export const updateFile = async ({
  assertAfter,
  filePath,
  name,
  transformer,
}: UpdateFileOptions) => {
  invariant(fs.existsSync(filePath), `[${name}] File not found: ${filePath}`);

  const original = await fs.readFile(filePath, 'utf8');
  const updated = transformer(original);

  if (assertAfter) {
    invariant(assertAfter(updated), `[${name}] Post-condition failed: ${filePath}`);
  }

  if (updated !== original) {
    await fs.writeFile(filePath, updated);
  }
};

export const writeFileEnsuring = async ({
  assertAfter,
  filePath,
  name,
  text,
}: WriteFileOptions) => {
  await updateFile({
    assertAfter,
    filePath,
    name,
    transformer: () => text,
  });
};

export const removePathEnsuring = async ({
  name,
  path: targetPath,
  requireExists,
}: RemovePathOptions) => {
  const exists = await fs.pathExists(targetPath);
  if (requireExists) {
    invariant(exists, `[${name}] Path not found: ${targetPath}`);
  }

  if (exists) {
    await fs.remove(targetPath);
  }

  const stillExists = await fs.pathExists(targetPath);
  invariant(!stillExists, `[${name}] Failed to remove path: ${targetPath}`);
};

export const isDirectRun = (importMetaUrl: string) => {
  const entry = process.argv[1];
  if (!entry) return false;

  return importMetaUrl === pathToFileURL(entry).href;
};

export const resolveTempDir = () => {
  const candidate = process.env.TEMP_DIR || process.argv[2];
  const resolved = candidate
    ? path.resolve(candidate)
    : path.resolve(process.cwd(), 'tmp', 'desktop-build');

  if (!fs.existsSync(resolved)) {
    throw new Error(`TEMP_DIR not found: ${resolved}`);
  }

  return resolved;
};

export const validateFiles = async (tempDir: string, targets: ValidationTarget[]) => {
  for (const target of targets) {
    const filePath = path.join(tempDir, target.path);

    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠️  Skipped validation, missing file: ${target.path}`);
      continue;
    }

    const code = await fs.readFile(filePath, 'utf8');
    parse(target.lang, code);
    console.log(`  ✅ Validated: ${target.path}`);
  }
};

export const runStandalone = async (
  name: string,
  modifier: (tempDir: string) => Promise<void>,
  validateTargets: ValidationTarget[] = [],
) => {
  try {
    const workdir = process.cwd();
    console.log(`▶️  Running ${name} with TEMP_DIR=${workdir}`);

    await modifier(workdir);

    if (validateTargets.length) {
      console.log('🔎 Validating modified files...');
      await validateFiles(workdir, validateTargets);
    }

    console.log(`✅ ${name} completed`);
  } catch (error) {
    console.error(`❌ ${name} failed`, error);
    process.exitCode = 1;
  }
};
