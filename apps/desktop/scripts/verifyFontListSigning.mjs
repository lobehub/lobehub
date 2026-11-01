import { execFileSync } from 'node:child_process';
import path from 'node:path';

const hasConfiguredValue = (value) =>
  (typeof value === 'string' && value.trim().length > 0) || typeof value === 'function';

const getVerificationEnvironment = (environment) => {
  const sanitizedEnvironment = { ...environment };
  for (const key of [
    'AZURE_CLIENT_SECRET',
    'CSC_KEY_PASSWORD',
    'CSC_LINK',
    'WIN_CSC_KEY_PASSWORD',
    'WIN_CSC_LINK',
  ]) {
    delete sanitizedEnvironment[key];
  }
  return sanitizedEnvironment;
};

export const verifyFontListSignature = async (
  context,
  { environment = process.env, execute = execFileSync, logger = console } = {},
) => {
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) {
    return { verified: false };
  }

  if (!hasConfiguredValue(environment.CSC_LINK)) {
    logger.info('Unsigned macOS build; system font helper verification skipped.');
    return { verified: false };
  }

  const productFilename = context.packager?.appInfo?.productFilename;
  if (!productFilename) throw new Error('Cannot resolve packaged application filename');

  const resourcesPath = path.join(
    context.appOutDir,
    `${productFilename}.app`,
    'Contents',
    'Resources',
  );
  const fontListHelperPath = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'font-list',
    'libs',
    'darwin',
    'fontlist',
  );

  try {
    execute('codesign', ['--verify', '--strict', '--verbose=2', fontListHelperPath], {
      encoding: 'utf8',
      env: getVerificationEnvironment(environment),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error('System font helper code-signature verification failed', { cause: error });
  }

  logger.info('Verified system font helper code signature.');
  return { verified: true };
};
