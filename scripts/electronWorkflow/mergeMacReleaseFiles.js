import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

const RELEASE_DIR = path.resolve('release');

// All channel manifest prefixes to process
const CHANNEL_PREFIXES = ['stable', 'nightly', 'canary', 'latest'];

/**
 * Detect platform type from YAML content
 * @param {Object} yamlContent
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
 * Merge x64 and ARM64 YAML files
 * @param {Object} x64Content
 * @param {Object} arm64Content
 * @returns {string}
 */
function mergeYamlFiles(x64Content, arm64Content) {
  const merged = {
    ...arm64Content,
    files: [...arm64Content.files, ...x64Content.files],
  };

  return YAML.stringify(merged);
}

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
 * Merge mac YAML files for a given channel prefix
 * @param {string} prefix - e.g. 'stable', 'nightly', 'canary', 'latest'
 * @param {string[]} releaseFiles - files in release directory
 */
function mergeForPrefix(prefix, releaseFiles) {
  const outputFileName = `${prefix}-mac.yml`;
  const macYmlFiles = releaseFiles.filter(
    (f) => f.startsWith(`${prefix}-mac`) && f.endsWith('.yml'),
  );

  if (macYmlFiles.length === 0) {
    console.log(`⚠️  No ${prefix}-mac*.yml files found, skipping`);
    return;
  }

  console.log(`\n🔍 Processing ${prefix} channel: ${macYmlFiles.join(', ')} -> ${outputFileName}`);

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
        writeLocalFile(path.join(RELEASE_DIR, outputFileName), content);
        return;
      } else {
        console.log(`⚠️  Unknown platform type: ${platform} in ${fileName}`);
      }
    } catch (error) {
      console.warn(`⚠️  Failed to parse ${fileName}:`, error);
    }
  }

  const x64Files = macFiles.filter((f) => f.platform === 'x64');
  const arm64Files = macFiles.filter((f) => f.platform === 'arm64');

  if (x64Files.length === 0 && arm64Files.length === 0) {
    console.log(`⚠️  No valid platform files found for ${prefix}`);
    return;
  }

  if (x64Files.length === 0) {
    console.log(`⚠️  No x64 files found for ${prefix}, using ARM64 only`);
    writeLocalFile(path.join(RELEASE_DIR, outputFileName), arm64Files[0].content);
    return;
  }

  if (arm64Files.length === 0) {
    console.log(`⚠️  No ARM64 files found for ${prefix}, using x64 only`);
    writeLocalFile(path.join(RELEASE_DIR, outputFileName), x64Files[0].content);
    return;
  }

  const x64File = x64Files[0];
  const arm64File = arm64Files[0];

  console.log(`🔄 Merging ${x64File.filename} (x64) and ${arm64File.filename} (ARM64)...`);
  const mergedContent = mergeYamlFiles(x64File.yaml, arm64File.yaml);

  const mergedFilePath = path.join(RELEASE_DIR, outputFileName);
  writeLocalFile(mergedFilePath, mergedContent);

  const mergedYaml = YAML.parse(mergedContent);
  const finalPlatform = detectPlatform(mergedYaml);

  if (finalPlatform === 'both') {
    console.log(`✅ Successfully merged both x64 and ARM64 platforms for ${prefix}`);
    console.log(`📊 Final file contains ${mergedYaml.files.length} files`);
  } else {
    console.warn(`⚠️  Merge result unexpected: ${finalPlatform}`);
  }
}

async function main() {
  try {
    console.log('🚀 Starting macOS Release file merge');
    console.log(`📁 Working directory: ${RELEASE_DIR}`);

    const releaseFiles = fs.readdirSync(RELEASE_DIR);
    console.log(`📂 Files in release directory: ${releaseFiles.join(', ')}`);

    for (const prefix of CHANNEL_PREFIXES) {
      mergeForPrefix(prefix, releaseFiles);
    }

    console.log('\n🎉 Merge complete!');
  } catch (error) {
    console.error('❌ Error during merge:', error);
    process.exit(1);
  }
}

await main();
