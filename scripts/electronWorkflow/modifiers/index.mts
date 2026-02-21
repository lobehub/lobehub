import { Lang } from '@ast-grep/napi';
import path from 'node:path';

import { modifyAppCode } from './appCode.mjs';
import { cleanUpCode } from './cleanUp.mjs';
import { convertDynamicToStatic } from './dynamicToStatic.mjs';
import { convertI18nDynamicToStatic } from './i18nDynamicToStatic.mjs';
import { convertNextDynamicToStatic } from './nextDynamicToStatic.mjs';
import { modifyNextConfig } from './nextConfig.mjs';
import { removeSuspenseFromConversation } from './removeSuspense.mjs';
import { modifyRoutes } from './routes.mjs';
import { convertSettingsContentToStatic } from './settingsContentToStatic.mjs';
import { modifyStaticExport } from './staticExport.mjs';
import { isDirectRun, runStandalone } from './utils.mjs';
import { wrapChildrenWithClientOnly } from './wrapChildrenWithClientOnly.mjs';

export const modifySourceForElectron = async (TEMP_DIR: string) => {
  await modifyNextConfig(TEMP_DIR);
  await modifyAppCode(TEMP_DIR);
  await wrapChildrenWithClientOnly(TEMP_DIR);
  await convertDynamicToStatic(TEMP_DIR);
  await convertNextDynamicToStatic(TEMP_DIR);
  await convertI18nDynamicToStatic(TEMP_DIR);
  await convertSettingsContentToStatic(TEMP_DIR);
  await removeSuspenseFromConversation(TEMP_DIR);
  await modifyRoutes(TEMP_DIR);
  await modifyStaticExport(TEMP_DIR);
  await cleanUpCode(TEMP_DIR);
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('modifySourceForElectron', modifySourceForElectron, [
    { lang: Lang.TypeScript, path: path.join(process.cwd(), 'next.config.ts') },
    { lang: Lang.Tsx, path: 'src/app/[variants]/page.tsx' },
    { lang: Lang.Tsx, path: 'src/layout/GlobalProvider/index.tsx' },
    { lang: Lang.Tsx, path: 'src/app/[variants]/router/desktopRouter.config.tsx' },
    { lang: Lang.Tsx, path: 'src/components/mdx/Image.tsx' },
    { lang: Lang.TypeScript, path: 'src/features/DevPanel/CacheViewer/getCacheEntries.ts' },
    { lang: Lang.TypeScript, path: 'src/server/translation.ts' },
  ]);
}
