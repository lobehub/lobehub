import { stat } from 'node:fs/promises';
import path from 'node:path';

import { loadFile } from '@lobechat/file-loaders';

import type { ReadFileParams, ReadFileResult } from '../types';

export async function readLocalFile({
  path: filePath,
  loc,
  fullContent,
}: ReadFileParams): Promise<ReadFileResult> {
  const effectiveLoc = fullContent ? undefined : (loc ?? [0, 200]);

  try {
    const fileDocument = await loadFile(filePath);

    // loadFile returns error in metadata instead of throwing
    if (fileDocument.metadata?.error) {
      return {
        charCount: 0,
        content: `Error accessing or processing file: ${fileDocument.metadata.error}`,
        createdTime: fileDocument.createdTime,
        fileType: fileDocument.fileType || 'unknown',
        filename: fileDocument.filename,
        lineCount: 0,
        loc: [0, 0],
        modifiedTime: fileDocument.modifiedTime,
        totalCharCount: 0,
        totalLineCount: 0,
      };
    }

    const lines = fileDocument.content.split('\n');
    const totalLineCount = lines.length;
    const totalCharCount = fileDocument.content.length;

    let content: string;
    let charCount: number;
    let lineCount: number;
    let actualLoc: [number, number];

    if (effectiveLoc === undefined) {
      content = fileDocument.content;
      charCount = totalCharCount;
      lineCount = totalLineCount;
      actualLoc = [0, totalLineCount];
    } else {
      const [startLine, endLine] = effectiveLoc;
      const selectedLines = lines.slice(startLine, endLine);
      content = selectedLines.join('\n');
      charCount = content.length;
      lineCount = selectedLines.length;
      actualLoc = effectiveLoc;
    }

    const fileType = fileDocument.fileType || 'unknown';

    const result: ReadFileResult = {
      charCount,
      content,
      createdTime: fileDocument.createdTime,
      fileType,
      filename: fileDocument.filename,
      lineCount,
      loc: actualLoc,
      modifiedTime: fileDocument.modifiedTime,
      totalCharCount,
      totalLineCount,
    };

    try {
      const stats = await stat(filePath);
      if (stats.isDirectory()) {
        result.content = 'This is a directory and cannot be read as plain text.';
        result.charCount = 0;
        result.lineCount = 0;
        result.totalCharCount = 0;
        result.totalLineCount = 0;
      }
    } catch {
      // Ignore stat errors
    }

    return result;
  } catch (error) {
    const errorMessage = (error as Error).message;
    return {
      charCount: 0,
      content: `Error accessing or processing file: ${errorMessage}`,
      createdTime: new Date(),
      fileType: path.extname(filePath).toLowerCase().replace('.', '') || 'unknown',
      filename: path.basename(filePath),
      lineCount: 0,
      loc: [0, 0],
      modifiedTime: new Date(),
      totalCharCount: 0,
      totalLineCount: 0,
    };
  }
}
