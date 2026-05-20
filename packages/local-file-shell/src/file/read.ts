import { stat } from 'node:fs/promises';
import path from 'node:path';

import {
  isReadableFileType,
  loadFile,
  sniffBinaryFile,
  SPECIAL_PARSED_FILE_TYPES,
} from '@lobechat/file-loaders';

import type { ReadFileParams, ReadFileResult } from '../types';
import { expandTilde } from './expandTilde';

/** Hard cap on file size we will read into memory at all (10MB). */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** Cap on the total chars returned to the agent. */
const MAX_OUTPUT_CHARS = 500_000;
/** Cap on chars per line. Keeps a single 27KB base64 line from blowing up the response. */
const MAX_LINE_CHARS = 8_000;

const inferFileType = (filePath: string): string =>
  path.extname(filePath).toLowerCase().replace('.', '') || 'unknown';

const buildErrorResult = (filePath: string, message: string): ReadFileResult => ({
  charCount: 0,
  content: message,
  createdTime: new Date(),
  fileType: inferFileType(filePath),
  filename: path.basename(filePath),
  lineCount: 0,
  loc: [0, 0],
  modifiedTime: new Date(),
  totalCharCount: 0,
  totalLineCount: 0,
});

const truncateLine = (line: string): { line: string; truncated: boolean } => {
  if (line.length <= MAX_LINE_CHARS) return { line, truncated: false };
  return {
    line: `${line.slice(0, MAX_LINE_CHARS)}… [line truncated: was ${line.length} chars, kept first ${MAX_LINE_CHARS}]`,
    truncated: true,
  };
};

export async function readLocalFile({
  path: rawPath,
  loc,
  fullContent,
}: ReadFileParams): Promise<ReadFileResult> {
  const filePath = expandTilde(rawPath) ?? rawPath;
  const effectiveLoc = fullContent ? undefined : (loc ?? [0, 200]);

  let stats;
  try {
    stats = await stat(filePath);
  } catch (error) {
    return buildErrorResult(
      filePath,
      `Error accessing or processing file: ${(error as Error).message}`,
    );
  }

  if (stats.isDirectory()) {
    return buildErrorResult(filePath, 'This is a directory and cannot be read as plain text.');
  }

  if (stats.size > MAX_FILE_SIZE_BYTES) {
    return buildErrorResult(
      filePath,
      `Error: File is too large to read (${stats.size} bytes, limit ${MAX_FILE_SIZE_BYTES}). Use grep / shell tools to inspect specific parts.`,
    );
  }

  const extension = path.extname(filePath).toLowerCase().replace('.', '');
  if (extension && !isReadableFileType(extension)) {
    return buildErrorResult(
      filePath,
      `Error: Unsupported binary file type: .${extension}. Use a different tool (e.g., 'runCommand' with file/hexdump/strings) to inspect binary files.`,
    );
  }

  const isSpecialParsed = SPECIAL_PARSED_FILE_TYPES.includes(extension);
  if (!isSpecialParsed) {
    try {
      const sniff = await sniffBinaryFile(filePath);
      if (sniff.isBinary) {
        return buildErrorResult(
          filePath,
          `Error: File appears to be binary (${sniff.reason}). Refusing to read as text.`,
        );
      }
    } catch {
      // Sniffing failures are not fatal; loadFile will surface the real error.
    }
  }

  try {
    const fileDocument = await loadFile(filePath);

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

    let workingLines: string[];
    let actualLoc: [number, number];
    if (effectiveLoc === undefined) {
      workingLines = lines;
      actualLoc = [0, totalLineCount];
    } else {
      const [startLine, endLine] = effectiveLoc;
      workingLines = lines.slice(startLine, endLine);
      actualLoc = effectiveLoc;
    }

    let linesTruncated = 0;
    const cappedLines = workingLines.map((line) => {
      const r = truncateLine(line);
      if (r.truncated) linesTruncated++;
      return r.line;
    });

    let content = cappedLines.join('\n');
    let truncated = false;
    if (content.length > MAX_OUTPUT_CHARS) {
      const originalLength = content.length;
      content = `${content.slice(0, MAX_OUTPUT_CHARS)}\n[content truncated: response was ${originalLength} chars, kept first ${MAX_OUTPUT_CHARS}. Use a smaller line range or grep to narrow down.]`;
      truncated = true;
    }

    const result: ReadFileResult = {
      charCount: content.length,
      content,
      createdTime: fileDocument.createdTime,
      fileType: fileDocument.fileType || 'unknown',
      filename: fileDocument.filename,
      lineCount: workingLines.length,
      loc: actualLoc,
      modifiedTime: fileDocument.modifiedTime,
      totalCharCount,
      totalLineCount,
    };
    if (truncated) result.truncated = true;
    if (linesTruncated > 0) result.linesTruncated = linesTruncated;
    return result;
  } catch (error) {
    return buildErrorResult(
      filePath,
      `Error accessing or processing file: ${(error as Error).message}`,
    );
  }
}
