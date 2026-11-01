import { CANVAS_ENTRY, CANVAS_LIMITS } from '../project/limits';
import {
  getCanvasFileExtension,
  isAllowedCanvasPath,
  isCanvasTextPath,
  normalizeCanvasPath,
  resolveCanvasHref,
} from '../project/path';
import { type CanvasProjectIndex, validateHtmlFile } from './html';
import { checkScriptText, collectCssRefs, lineAt } from './text';
import type {
  CanvasIssue,
  CanvasProjectFile,
  CanvasValidationOptions,
  CanvasValidationResult,
} from './types';

const decoder = new TextDecoder();

const byteLength = (content: string | Uint8Array) =>
  typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.byteLength;

const toText = (content: string | Uint8Array) =>
  typeof content === 'string' ? content : decoder.decode(content);

export const validateCanvasProject = (
  files: CanvasProjectFile[],
  options: CanvasValidationOptions = {},
): CanvasValidationResult => {
  const issues: CanvasIssue[] = [];
  const entries = new Map<string, CanvasProjectFile>();
  let totalBytes = 0;

  for (const file of files) {
    const path = normalizeCanvasPath(file.path);
    if (!path || !isAllowedCanvasPath(path)) {
      issues.push({
        file: file.path,
        message: path
          ? `"${file.path}" has a file type a Canvas cannot hold.`
          : `"${file.path}" is not a valid project path (relative, no "..", letters/digits/-_.@ only).`,
        rule: 'invalid-path',
      });
      continue;
    }
    if (entries.has(path)) {
      issues.push({
        file: path,
        message: `"${path}" appears more than once.`,
        rule: 'duplicate-path',
      });
      continue;
    }

    const size = file.size ?? byteLength(file.content);
    totalBytes += size;
    const limit = isCanvasTextPath(path)
      ? CANVAS_LIMITS.maxTextFileBytes
      : CANVAS_LIMITS.maxFileBytes;
    if (size > limit) {
      issues.push({
        file: path,
        message: `"${path}" is ${size} bytes; the limit is ${limit}.`,
        rule: 'file-too-large',
      });
    }
    entries.set(path, { content: file.content, path });
  }

  if (files.length > CANVAS_LIMITS.maxFiles) {
    issues.push({
      message: `A Canvas holds at most ${CANVAS_LIMITS.maxFiles} files; got ${files.length}.`,
      rule: 'too-many-files',
    });
  }
  if (totalBytes > CANVAS_LIMITS.maxTotalBytes) {
    issues.push({
      message: `The project is ${totalBytes} bytes; the limit is ${CANVAS_LIMITS.maxTotalBytes}.`,
      rule: 'project-too-large',
    });
  }
  if (!entries.has(CANVAS_ENTRY)) {
    issues.push({
      message: `The project needs an entry page at "${CANVAS_ENTRY}".`,
      rule: 'entry-missing',
    });
  }

  const project: CanvasProjectIndex = {
    has: (path) => entries.has(path),
    readText: (path) => {
      const entry = entries.get(path);
      return entry && isCanvasTextPath(path) ? toText(entry.content) : undefined;
    },
  };

  for (const [path, entry] of entries) {
    const extension = getCanvasFileExtension(path);
    if (extension === 'html') {
      issues.push(...validateHtmlFile(path, toText(entry.content), project, options));
    } else if (extension === 'js' || extension === 'mjs') {
      issues.push(...checkScriptText(path, toText(entry.content)));
    } else if (extension === 'css') {
      const text = toText(entry.content);
      for (const ref of collectCssRefs(text)) {
        const resolved = resolveCanvasHref(path, ref.href);
        const line = lineAt(text, ref.index);
        if (resolved.kind === 'remote') {
          issues.push({
            file: path,
            line,
            message: `CSS reference "${ref.href}" is remote. Copy it into the project.`,
            rule: 'remote-resource',
          });
        } else if (resolved.kind === 'local' && (!resolved.path || !entries.has(resolved.path))) {
          issues.push({
            file: path,
            line,
            message: `CSS reference "${ref.href}" points at a file that is not in the project.`,
            rule: 'broken-reference',
          });
        }
      }
    }
  }

  return { issues, ok: issues.length === 0 };
};
