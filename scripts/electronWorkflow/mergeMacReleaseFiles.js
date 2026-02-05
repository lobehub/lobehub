import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

// 配置
// Support both stable-mac.yml (stable channel) and latest-mac.yml (fallback)
const STABLE_outputFileName = 'stable-mac.yml';
const LATEST_outputFileName = 'latest-mac.yml';
const RELEASE_DIR = path.resolve('release');

/**
 * 检测 latest-mac.yml 文件的平台类型
 * @param {Object} yamlContent - YAML 文件内容
 * @returns {'x64' | 'arm64' | 'both' | 'none'}
 */
function detectPlatform(yamlContent) {
  const hasX64 = yamlContent.files.some((file) => file.url.includes('-x64.dmg'));
  const hasArm64 = yamlContent.files.some((file) => file.url.includes('-arm64.dmg'));

  if (hasX64 && hasArm64) return 'both';
  if (hasX64 && !hasArm64) return 'x64';
  if (!hasX64 && hasArm64) return 'arm64';
  return 'none';
}

/**
 * 合并两个 latest-mac.yml 文件
 * @param {Object} x64Content - x64 平台的 YAML 内容
 * @param {Object} arm64Content - ARM64 平台的 YAML 内容
 * @returns {string} 合并后的 YAML 字符串
 */
function mergeYamlFiles(x64Content, arm64Content) {
  // 以 ARM64 为基础（Apple Silicon 优先）
  const merged = {
    ...arm64Content,
    files: [...arm64Content.files, ...x64Content.files],
  };

  return YAML.stringify(merged);
}

/**
 * 读取本地文件
 * @param {string} filePath - 文件路径
 * @returns {string | null} 文件内容或 null
 */
function readLocalFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      console.log(`✅ Read local file: ${filePath} (${content.length} chars)`);
      return content;
    }
    console.log(`⚠️  Local file not found: ${filePath}`);
    return null;
  } catch (error) {
    console.error(`❌ Error reading local file ${filePath}:`, error);
    return null;
  }
}

/**
 * 写入本地文件
 * @param {string} filePath - 文件路径
 * @param {string} content - 文件内容
 */
function writeLocalFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Written local file: ${filePath} (${content.length} chars)`);
  } catch (error) {
    console.error(`❌ Error writing local file ${filePath}:`, error);
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('🚀 Starting macOS Release file merge');
    console.log(`📁 Working directory: ${RELEASE_DIR}`);

    // 1. 检查 release 目录下的所有文件
    const releaseFiles = fs.readdirSync(RELEASE_DIR);
    console.log(`📂 Files in release directory: ${releaseFiles.join(', ')}`);

    // 2. 查找所有 stable-mac*.yml 和 latest-mac*.yml 文件
    // Prioritize stable-mac*.yml, fallback to latest-mac*.yml
    const stableMacYmlFiles = releaseFiles.filter(
      (f) => f.startsWith('stable-mac') && f.endsWith('.yml'),
    );
    const latestMacYmlFiles = releaseFiles.filter(
      (f) => f.startsWith('latest-mac') && f.endsWith('.yml'),
    );

    // Use stable files if available, otherwise use latest
    const macYmlFiles = stableMacYmlFiles.length > 0 ? stableMacYmlFiles : latestMacYmlFiles;
    const outputFileName =
      stableMacYmlFiles.length > 0 ? STABLE_outputFileName : LATEST_outputFileName;

    console.log(`🔍 Found stable macOS YAML files: ${stableMacYmlFiles.join(', ') || 'none'}`);
    console.log(`🔍 Found latest macOS YAML files: ${latestMacYmlFiles.join(', ') || 'none'}`);
    console.log(`🔍 Using files: ${macYmlFiles.join(', ')} -> ${outputFileName}`);

    if (macYmlFiles.length === 0) {
      console.log('⚠️  No macOS YAML files found, skipping merge');
      return;
    }

    // 3. 处理找到的文件，识别平台
    const macFiles = [];

    for (const fileName of macYmlFiles) {
      const filePath = path.join(RELEASE_DIR, fileName);
      const content = readLocalFile(filePath);

      if (!content) continue;

      try {
        const yamlContent = YAML.parse(content);
        const platform = detectPlatform(yamlContent);

        if (platform === 'x64' || platform === 'arm64') {
          macFiles.push({ content, filename: fileName, platform, yaml: yamlContent });
          console.log(`🔍 Detected ${platform} platform in ${fileName}`);
        } else if (platform === 'both') {
          console.log(`✅ Found already merged file: ${fileName}`);
          // 如果已经是合并后的文件，直接复制为最终文件
          writeLocalFile(path.join(RELEASE_DIR, outputFileName), content);
          return;
        } else {
          console.log(`⚠️  Unknown platform type: ${platform} in ${fileName}`);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to parse ${fileName}:`, error);
      }
    }

    // 4. 检查是否有两个不同平台的文件
    const x64Files = macFiles.filter((f) => f.platform === 'x64');
    const arm64Files = macFiles.filter((f) => f.platform === 'arm64');

    if (x64Files.length === 0 && arm64Files.length === 0) {
      console.log('⚠️  No valid platform files found');
      return;
    }

    if (x64Files.length === 0) {
      console.log('⚠️  No x64 files found, using ARM64 only');
      writeLocalFile(path.join(RELEASE_DIR, outputFileName), arm64Files[0].content);
      return;
    }

    if (arm64Files.length === 0) {
      console.log('⚠️  No ARM64 files found, using x64 only');
      writeLocalFile(path.join(RELEASE_DIR, outputFileName), x64Files[0].content);
      return;
    }

    // 5. 合并 x64 和 ARM64 文件
    const x64File = x64Files[0];
    const arm64File = arm64Files[0];

    console.log(`🔄 Merging ${x64File.filename} (x64) and ${arm64File.filename} (ARM64)...`);
    const mergedContent = mergeYamlFiles(x64File.yaml, arm64File.yaml);

    // 6. 保存合并后的文件
    const mergedFilePath = path.join(RELEASE_DIR, outputFileName);
    writeLocalFile(mergedFilePath, mergedContent);

    // 7. 验证合并结果
    const mergedYaml = YAML.parse(mergedContent);
    const finalPlatform = detectPlatform(mergedYaml);

    if (finalPlatform === 'both') {
      console.log('✅ Successfully merged both x64 and ARM64 platforms');
      console.log(`📊 Final file contains ${mergedYaml.files.length} files`);
    } else {
      console.warn(`⚠️  Merge result unexpected: ${finalPlatform}`);
    }

    console.log('🎉 Merge complete!');
  } catch (error) {
    console.error('❌ Error during merge:', error);
    process.exit(1);
  }
}

// 运行主函数
await main();
