import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

interface ReplaceConfig {
  /** List of components to replace */
  components: string[];
  /** Whether to run in dry-run mode (preview only, no actual modifications) */
  dryRun?: boolean;
  /** File extension whitelist */
  fileExtensions?: string[];
  /** Source package name */
  fromPackage: string;
  /** Directory to scan */
  targetDir: string;
  /** Target package name */
  toPackage: string;
}

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dir: string, extensions: string[]): string[] {
  const files: string[] = [];

  function walk(currentPath: string) {
    const items = readdirSync(currentPath);

    for (const item of items) {
      const fullPath = join(currentPath, item);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip directories like node_modules
        if (!['node_modules', '.git', 'dist', 'build', '.next'].includes(item)) {
          walk(fullPath);
        }
      } else if (stat.isFile()) {
        const hasValidExtension = extensions.some((ext) => fullPath.endsWith(ext));
        if (hasValidExtension) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Parse import statements and extract imported components
 */
function parseImportStatement(line: string, packageName: string) {
  // Match import { ... } from 'package'
  const importRegex = new RegExp(
    `import\\s+{([^}]+)}\\s+from\\s+['"]${packageName.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')}['"]`,
  );
  const match = line.match(importRegex);

  if (!match) return null;

  const importContent = match[1];
  const components = importContent
    .split(',')
    .map((item) => {
      const trimmed = item.trim();
      // Handle as aliases: ComponentName as AliasName
      const asMatch = trimmed.match(/^(\w+)(?:\s+as\s+(\w+))?/);
      return asMatch
        ? {
            alias: asMatch[2] || null,
            name: asMatch[1],
            raw: trimmed,
          }
        : null;
    })
    .filter(Boolean) as Array<{ alias: string | null; name: string; raw: string }>;

  return {
    components,
    fullMatch: match[0],
    indentation: line.match(/^\s*/)?.[0] || '',
  };
}

/**
 * Replace import statements in a file
 */
function replaceImportsInFile(filePath: string, config: ReplaceConfig): boolean {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let modified = false;
  const newLines: string[] = [];

  for (const line of lines) {
    const parsed = parseImportStatement(line, config.fromPackage);

    if (!parsed) {
      newLines.push(line);
      continue;
    }

    // Find components to replace and components to keep
    const toReplace = parsed.components.filter((comp) => config.components.includes(comp.name));
    const toKeep = parsed.components.filter((comp) => !config.components.includes(comp.name));

    if (toReplace.length === 0) {
      // No components to replace
      newLines.push(line);
      continue;
    }

    modified = true;

    // Generate new import statement
    const { indentation } = parsed;

    // If there are components to keep, preserve the original import
    if (toKeep.length > 0) {
      const keepImports = toKeep.map((c) => c.raw).join(', ');
      newLines.push(`${indentation}import { ${keepImports} } from '${config.fromPackage}';`);
    }

    // Add new import
    const replaceImports = toReplace.map((c) => c.raw).join(', ');
    newLines.push(`${indentation}import { ${replaceImports} } from '${config.toPackage}';`);
  }

  if (modified) {
    const newContent = newLines.join('\n');
    if (!config.dryRun) {
      writeFileSync(filePath, newContent, 'utf8');
    }
    return true;
  }

  return false;
}

/**
 * Execute replacement
 */
function executeReplace(config: ReplaceConfig) {
  const extensions = config.fileExtensions || ['.ts', '.tsx', '.js', '.jsx'];
  const files = getAllFiles(config.targetDir, extensions);

  console.log(`\n🔍 扫描目录: ${config.targetDir}`);
  console.log(`📦 从 "${config.fromPackage}" 替换到 "${config.toPackage}"`);
  console.log(`🎯 目标组件: ${config.components.join(', ')}`);
  console.log(`📄 找到 ${files.length} 个文件\n`);

  if (config.dryRun) {
    console.log('🔔 [DRY RUN 模式] 仅预览，不会实际修改文件\n');
  }

  let modifiedCount = 0;
  const modifiedFiles: string[] = [];

  for (const file of files) {
    const wasModified = replaceImportsInFile(file, config);
    if (wasModified) {
      modifiedCount++;
      modifiedFiles.push(relative(process.cwd(), file));
    }
  }

  console.log('\n✅ 完成！');
  console.log(`📝 修改了 ${modifiedCount} 个文件\n`);

  if (modifiedFiles.length > 0) {
    console.log('修改的文件:');
    for (const file of modifiedFiles) {
      console.log(`  - ${file}`);
    }
  }
}

// ============ Main function ============

/**
 * Parse configuration from command line arguments
 */
function parseArgs(): ReplaceConfig | null {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
使用方法:
  bun run scripts/replaceComponentImports.ts [选项]

选项:
  --components <comp1,comp2,...>  要替换的组件列表（逗号分隔）
  --from <package>                原始包名
  --to <package>                  目标包名
  --dir <directory>               要扫描的目录（默认: src）
  --ext <.ext1,.ext2,...>         文件扩展名（默认: .ts,.tsx,.js,.jsx）
  --dry-run                       仅预览，不实际修改文件
  --help, -h                      显示帮助信息

示例:
  # 将 antd 的 Skeleton 和 Empty 替换为 @lobehub/ui
  bun run scripts/replaceComponentImports.ts \\
    --components Skeleton,Empty \\
    --from antd \\
    --to @lobehub/ui \\
    --dir src

  # 仅预览，不修改
  bun run scripts/replaceComponentImports.ts \\
    --components Skeleton,Empty \\
    --from antd \\
    --to @lobehub/ui \\
    --dry-run
`);
    return null;
  }

  const getArgValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
  };

  const componentsStr = getArgValue('--components');
  const fromPackage = getArgValue('--from');
  const toPackage = getArgValue('--to');
  const targetDir = getArgValue('--dir') || 'src';
  const extStr = getArgValue('--ext');
  const dryRun = args.includes('--dry-run');

  if (!componentsStr || !fromPackage || !toPackage) {
    console.error('❌ 错误: 必须指定 --components, --from 和 --to 参数');
    console.error('使用 --help 查看帮助信息');

    process.exit(1);
  }

  return {
    components: componentsStr.split(',').map((c) => c.trim()),
    dryRun,
    fileExtensions: extStr ? extStr.split(',').map((e) => e.trim()) : undefined,
    fromPackage,
    targetDir,
    toPackage,
  };
}

// Execute script
const config = parseArgs();
if (config) {
  executeReplace(config);
}
