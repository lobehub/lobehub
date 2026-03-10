import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

interface ReplaceConfig {
  /** 要替换的组件列表 */
  components: string[];
  /** 是否为 dry-run 模式（仅预览，不实际修改） */
  dryRun?: boolean;
  /** 文件扩展名白名单 */
  fileExtensions?: string[];
  /** 原始包名 */
  fromPackage: string;
  /** 要扫描的目录 */
  targetDir: string;
  /** 目标包名 */
  toPackage: string;
}

/**
 * 递归获取目录下所有文件
 */
function getAllFiles(dir: string, extensions: string[]): string[] {
  const files: string[] = [];

  function walk(currentPath: string) {
    const items = readdirSync(currentPath);

    for (const item of items) {
      const fullPath = join(currentPath, item);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // 跳过 node_modules 等目录
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
 * 解析 import 语句，提取导入的组件
 */
function parseImportStatement(line: string, packageName: string) {
  // 匹配 import { ... } from 'package'
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
      // 处理 as 别名: ComponentName as AliasName
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
 * 替换文件中的 import 语句
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

    // 找出需要替换的组件和保留的组件
    const toReplace = parsed.components.filter((comp) => config.components.includes(comp.name));
    const toKeep = parsed.components.filter((comp) => !config.components.includes(comp.name));

    if (toReplace.length === 0) {
      // 没有需要替换的组件
      newLines.push(line);
      continue;
    }

    modified = true;

    // 生成新的 import 语句
    const { indentation } = parsed;

    // 如果有保留的组件，保留原来的 import
    if (toKeep.length > 0) {
      const keepImports = toKeep.map((c) => c.raw).join(', ');
      newLines.push(`${indentation}import { ${keepImports} } from '${config.fromPackage}';`);
    }

    // 添加新的 import
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
 * 执行替换
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

// ============ 主函数 ============

/**
 * 从命令行参数解析配置
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

// 执行脚本
const config = parseArgs();
if (config) {
  executeReplace(config);
}
