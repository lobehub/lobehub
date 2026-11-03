import fs from 'node:fs';
import path from 'node:path';

// Configuration
const config: Config = {
  dirPath: './locales/en-US', // Replace with your directory path
  ignoredFiles: ['models', 'providers', 'auth'], // Files to ignore
};

interface FileCount {
  count: number;
  filename: string;
}

interface Config {
  dirPath: string;
  ignoredFiles: string[];
}

// Count the number of characters in a string
function countChineseChars(str: string): number {
  if (typeof str !== 'string') return 0;
  return str.split(' ').length;
}

// Recursively process all values in an object
function processValue(value: any): number {
  let count = 0;

  if (typeof value === 'string') {
    count += countChineseChars(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => {
      count += processValue(item);
    });
  } else if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((val) => {
      count += processValue(val);
    });
  }

  return count;
}

// Read and process JSON file
function processJsonFile(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(content);
    return processValue(json);
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return 0;
  }
}

// Recursively traverse directory
function traverseDirectory(dirPath: string, ignoredFiles: string[]): FileCount[] {
  const results: FileCount[] = [];
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);
    const filename = path.parse(file).name;

    // Skip ignored files
    if (ignoredFiles.includes(filename)) {
      return;
    }

    if (stat.isDirectory()) {
      results.push(...traverseDirectory(fullPath, ignoredFiles));
    } else if (path.extname(file) === '.json') {
      const count = processJsonFile(fullPath);
      results.push({ count, filename });
    }
  });

  return results;
}

// Main function
function main(config: Config): void {
  const { dirPath, ignoredFiles } = config;

  console.log('开始统计单词数量...\n');
  console.log('忽略的文件:', ignoredFiles.join(', '), '\n');

  const results = traverseDirectory(dirPath, ignoredFiles);

  // Sort by word count in descending order
  const sortedResults = results.sort((a, b) => b.count - a.count);

  // Calculate total count
  const totalCount = results.reduce((sum, item) => sum + item.count, 0);

  // Output results
  console.log('文件统计结果（按单词数降序）：');
  console.log('----------------------------------------');
  sortedResults.forEach(({ filename, count }) => {
    console.log(`${filename.padEnd(20)} ${count.toString().padStart(6)} 个单词`);
  });
  console.log('----------------------------------------');
  console.log(`总计: ${totalCount} 个单词`);
}

main(config);
