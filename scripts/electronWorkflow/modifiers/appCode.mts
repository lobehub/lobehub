import { Lang, parse } from '@ast-grep/napi';
import path from 'node:path';

import {
  isDirectRun,
  normalizeEol,
  removePathEnsuring,
  runStandalone,
  updateFile,
  writeFileEnsuring,
} from './utils.mjs';

const desktopOnlyVariantsPage = `import { DynamicLayoutProps } from '@/types/next';

import DesktopRouter from './router';

export default async (_props: DynamicLayoutProps) => {
  return <DesktopRouter />;
};
`;

const stripDevPanel = (code: string) => {
  let result = code.replace(/import DevPanel from ['"]@\/features\/DevPanel['"];\r?\n?/, '');

  result = result.replace(
    /[\t ]*{process\.env\.NODE_ENV === 'development' && <DevPanel \/>}\s*\r?\n?/,
    '',
  );

  return result;
};

const assertDevPanelStripped = (code: string) =>
  !/import\s+DevPanel\s+from\s+['"]@\/features\/DevPanel['"]/.test(code) &&
  !/<DevPanel\b/.test(code) &&
  !/NEXT_PUBLIC_ENABLE_DEV_PANEL|DevPanel\s*\/>/.test(code);

const removeSecurityTab = (code: string) => {
  const componentEntryRegex =
    /[\t ]*\[SettingsTabs\.Security]: dynamic\(\(\) => import\('\.\.\/security'\), {[\s\S]+?}\),\s*\r?\n/;
  const securityTabRegex = /[\t ]*SettingsTabs\.Security,\s*\r?\n/;

  return code.replace(componentEntryRegex, '').replace(securityTabRegex, '');
};

const assertSecurityTabRemoved = (code: string) => !/\bSettingsTabs\.Security\b/.test(code);

const removeSpeedInsightsAndAnalytics = (code: string) => {
  const ast = parse(Lang.Tsx, code);
  const root = ast.root();
  const edits: Array<{ start: number; end: number; text: string }> = [];

  // Remove SpeedInsights import
  const speedInsightsImport = root.find({
    rule: {
      pattern: 'import { SpeedInsights } from $SOURCE',
    },
  });
  if (speedInsightsImport) {
    const range = speedInsightsImport.range();
    edits.push({ start: range.start.index, end: range.end.index, text: '' });
  }

  // Remove Analytics import
  const analyticsImport = root.find({
    rule: {
      pattern: 'import Analytics from $SOURCE',
    },
  });
  if (analyticsImport) {
    const range = analyticsImport.range();
    edits.push({ start: range.start.index, end: range.end.index, text: '' });
  }

  // Remove Suspense block containing Analytics and SpeedInsights
  // Find all Suspense blocks and check which one contains Analytics or SpeedInsights
  const allSuspenseBlocks = root.findAll({
    rule: {
      pattern: '<Suspense fallback={null}>$$$</Suspense>',
    },
  });

  for (const suspenseBlock of allSuspenseBlocks) {
    const hasAnalytics = suspenseBlock.find({
      rule: {
        pattern: '<Analytics />',
      },
    });

    const hasSpeedInsights = suspenseBlock.find({
      rule: {
        pattern: '<SpeedInsights />',
      },
    });

    if (hasAnalytics || hasSpeedInsights) {
      const range = suspenseBlock.range();
      edits.push({ start: range.start.index, end: range.end.index, text: '' });
      break; // Only remove the first matching Suspense block
    }
  }

  // Remove inVercel variable if it's no longer used
  const inVercelVar = root.find({
    rule: {
      pattern: 'const inVercel = process.env.VERCEL === "1";',
    },
  });
  if (inVercelVar) {
    // Check if inVercel is still used elsewhere
    const allInVercelUsages = root.findAll({
      rule: {
        regex: 'inVercel',
      },
    });
    // If only the declaration remains, remove it
    if (allInVercelUsages.length === 1) {
      const range = inVercelVar.range();
      edits.push({ start: range.start.index, end: range.end.index, text: '' });
    }
  }

  // Apply edits
  if (edits.length === 0) return code;

  edits.sort((a, b) => b.start - a.start);
  let result = code;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }

  return result;
};

const assertSpeedInsightsAndAnalyticsRemoved = (code: string) =>
  !/<Analytics\s*\/>/.test(code) &&
  !/<SpeedInsights\s*\/>/.test(code) &&
  !/import\s+\{\s*SpeedInsights\s*\}\s+from\b/.test(code) &&
  !/import\s+Analytics\s+from\b/.test(code);

const removeClerkLogic = (code: string) => {
  const ast = parse(Lang.Tsx, code);
  const root = ast.root();
  const edits: Array<{ start: number; end: number; text: string }> = [];

  // Remove Clerk import - try multiple patterns
  const clerkImportPatterns = [
    { pattern: 'import Clerk from $SOURCE' },
    { pattern: "import Clerk from './Clerk'" },
    { pattern: "import Clerk from './Clerk/index'" },
  ];

  for (const pattern of clerkImportPatterns) {
    const clerkImport = root.find({
      rule: pattern,
    });
    if (clerkImport) {
      const range = clerkImport.range();
      edits.push({ start: range.start.index, end: range.end.index, text: '' });
      break;
    }
  }

  const findClerkIfStatement = () => {
    const directMatch = root.find({
      rule: {
        pattern: 'if (authEnv.NEXT_PUBLIC_ENABLE_CLERK_AUTH) { $$$ }',
      },
    });

    if (directMatch) return directMatch;

    const allIfStatements = root.findAll({
      rule: {
        kind: 'if_statement',
      },
    });

    for (const ifStmt of allIfStatements) {
      const condition = ifStmt.find({
        rule: {
          pattern: 'authEnv.NEXT_PUBLIC_ENABLE_CLERK_AUTH',
        },
      });

      if (condition) return ifStmt;
    }

    return null;
  };

  const clerkIfStatement = findClerkIfStatement();

  if (clerkIfStatement) {
    const ifRange = clerkIfStatement.range();
    const elseClause = clerkIfStatement.find({
      rule: {
        kind: 'else_clause',
      },
    });

    if (elseClause) {
      const elseIfStmt = elseClause.find({
        rule: {
          kind: 'if_statement',
        },
      });

      if (elseIfStmt) {
        // Promote the first else-if to a top-level if and keep the rest of the chain
        const elseRange = elseClause.range();
        const replacement = code
          .slice(elseRange.start.index, elseRange.end.index)
          .replace(/^\s*else\s+/, '');

        edits.push({
          start: ifRange.start.index,
          end: ifRange.end.index,
          text: replacement,
        });
      } else {
        const elseBlock = elseClause.find({
          rule: {
            kind: 'statement_block',
          },
        });

        if (elseBlock) {
          edits.push({
            start: ifRange.start.index,
            end: ifRange.end.index,
            text: code.slice(elseBlock.range().start.index, elseBlock.range().end.index),
          });
        } else {
          edits.push({ start: ifRange.start.index, end: ifRange.end.index, text: '' });
        }
      }
    } else {
      edits.push({ start: ifRange.start.index, end: ifRange.end.index, text: '' });
    }
  }

  // Apply edits
  if (edits.length === 0) return code;

  edits.sort((a, b) => b.start - a.start);
  let result = code;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }

  return result;
};

const assertClerkLogicRemoved = (code: string) =>
  !/\bNEXT_PUBLIC_ENABLE_CLERK_AUTH\b/.test(code) &&
  !/\bauthEnv\.NEXT_PUBLIC_ENABLE_CLERK_AUTH\b/.test(code);

const removeManifestFromMetadata = (code: string) => {
  const ast = parse(Lang.Tsx, code);
  const root = ast.root();
  const edits: Array<{ start: number; end: number; text: string }> = [];

  // Find generateMetadata function
  const generateMetadataFunc = root.find({
    rule: {
      pattern: 'export const generateMetadata = async ($$$) => { $$$ }',
    },
  });

  if (!generateMetadataFunc) return code;

  // Find return statement
  const returnStatement = generateMetadataFunc.find({
    rule: {
      kind: 'return_statement',
    },
  });

  if (!returnStatement) return code;

  // Find the object in return statement
  const returnObject = returnStatement.find({
    rule: {
      kind: 'object',
    },
  });

  if (!returnObject) return code;

  // Find all pair nodes (key-value pairs in the object)
  const allPairs = returnObject.findAll({
    rule: {
      kind: 'pair',
    },
  });

  const keysToRemove = ['manifest', 'metadataBase'];

  for (const pair of allPairs) {
    // Find the property_identifier or identifier
    const key = pair.find({
      rule: {
        any: [{ kind: 'property_identifier' }, { kind: 'identifier' }],
      },
    });

    if (key && keysToRemove.includes(key.text())) {
      const range = pair.range();
      // Include the trailing comma if present
      const afterPair = code.slice(range.end.index, range.end.index + 10);
      const commaMatch = afterPair.match(/^,\s*/);
      const endIndex = commaMatch ? range.end.index + commaMatch[0].length : range.end.index;

      edits.push({
        start: range.start.index,
        end: endIndex,
        text: '',
      });
    }
  }

  // Apply edits
  if (edits.length === 0) return code;

  edits.sort((a, b) => b.start - a.start);
  let result = code;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }

  return result;
};

const assertMetadataManifestRemoved = (code: string) =>
  !/\bmanifest\s*:/.test(code) && !/\bmetadataBase\s*:/.test(code);

export const modifyAppCode = async (TEMP_DIR: string) => {
  // 1. Replace src/app/[variants]/page.tsx with a desktop-only entry
  const variantsPagePath = path.join(TEMP_DIR, 'src/app/[variants]/page.tsx');
  console.log('  Processing src/app/[variants]/page.tsx...');
  await writeFileEnsuring({
    filePath: variantsPagePath,
    name: 'modifyAppCode:variantsPage',
    text: desktopOnlyVariantsPage,
    assertAfter: (code) => normalizeEol(code) === normalizeEol(desktopOnlyVariantsPage),
  });

  // 2. Remove DevPanel from src/layout/GlobalProvider/index.tsx
  const globalProviderPath = path.join(TEMP_DIR, 'src/layout/GlobalProvider/index.tsx');
  console.log('  Processing src/layout/GlobalProvider/index.tsx...');
  await updateFile({
    filePath: globalProviderPath,
    name: 'modifyAppCode:stripDevPanel',
    transformer: stripDevPanel,
    assertAfter: assertDevPanelStripped,
  });

  // 3. Delete src/app/[variants]/(main)/settings/security directory
  const securityDirPath = path.join(TEMP_DIR, 'src/app/[variants]/(main)/settings/security');
  console.log('  Deleting src/app/[variants]/(main)/settings/security directory...');
  await removePathEnsuring({
    name: 'modifyAppCode:deleteSecurityDir',
    path: securityDirPath,
  });

  // 4. Remove Security tab wiring from SettingsContent
  const settingsContentPath = path.join(
    TEMP_DIR,
    'src/app/[variants]/(main)/settings/features/SettingsContent.tsx',
  );
  console.log('  Processing src/app/[variants]/(main)/settings/features/SettingsContent.tsx...');
  await updateFile({
    filePath: settingsContentPath,
    name: 'modifyAppCode:removeSecurityTab',
    transformer: removeSecurityTab,
    assertAfter: assertSecurityTabRemoved,
  });

  // 5. Remove SpeedInsights and Analytics from src/app/[variants]/layout.tsx
  const variantsLayoutPath = path.join(TEMP_DIR, 'src/app/[variants]/layout.tsx');
  console.log('  Processing src/app/[variants]/layout.tsx...');
  await updateFile({
    filePath: variantsLayoutPath,
    name: 'modifyAppCode:removeSpeedInsightsAndAnalytics',
    transformer: removeSpeedInsightsAndAnalytics,
    assertAfter: assertSpeedInsightsAndAnalyticsRemoved,
  });

  // 6. Remove Clerk logic from src/layout/AuthProvider/index.tsx
  const authProviderPath = path.join(TEMP_DIR, 'src/layout/AuthProvider/index.tsx');
  console.log('  Processing src/layout/AuthProvider/index.tsx...');
  await updateFile({
    filePath: authProviderPath,
    name: 'modifyAppCode:removeClerkLogic',
    transformer: removeClerkLogic,
    assertAfter: assertClerkLogicRemoved,
  });

  // 7. Replace mdx Image component with next/image export
  const mdxImagePath = path.join(TEMP_DIR, 'src/components/mdx/Image.tsx');
  console.log('  Processing src/components/mdx/Image.tsx...');
  await writeFileEnsuring({
    filePath: mdxImagePath,
    name: 'modifyAppCode:replaceMdxImage',
    text: "export { default } from 'next/image';\n",
    assertAfter: (code) => normalizeEol(code).trim() === "export { default } from 'next/image';",
  });

  // 8. Remove manifest from metadata
  const metadataPath = path.join(TEMP_DIR, 'src/app/[variants]/metadata.ts');
  console.log('  Processing src/app/[variants]/metadata.ts...');
  await updateFile({
    filePath: metadataPath,
    name: 'modifyAppCode:removeManifestFromMetadata',
    transformer: removeManifestFromMetadata,
    assertAfter: assertMetadataManifestRemoved,
  });
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('modifyAppCode', modifyAppCode, [
    { lang: Lang.Tsx, path: 'src/app/[variants]/page.tsx' },
    { lang: Lang.Tsx, path: 'src/layout/GlobalProvider/index.tsx' },
    { lang: Lang.Tsx, path: 'src/app/[variants]/(main)/settings/features/SettingsContent.tsx' },
    { lang: Lang.Tsx, path: 'src/app/[variants]/layout.tsx' },
    { lang: Lang.Tsx, path: 'src/layout/AuthProvider/index.tsx' },
    { lang: Lang.Tsx, path: 'src/components/mdx/Image.tsx' },
    { lang: Lang.Tsx, path: 'src/app/[variants]/metadata.ts' },
  ]);
}
