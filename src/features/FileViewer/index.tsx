'use client';

import { type CSSProperties, memo } from 'react';

import { type FileListItem } from '@/types/files';

import NotSupport from './NotSupport';
import ImageViewer from './Renderer/Image';
import JavaScriptViewer from './Renderer/JavaScript';
import MSDocViewer from './Renderer/MSDoc';
import MarkdownViewer from './Renderer/Markdown';
import PDFViewer from './Renderer/PDF';
import TXTViewer from './Renderer/TXT';
import VideoViewer from './Renderer/Video';

// File type definitions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
const IMAGE_MIME_TYPES = new Set([
  'image/jpg',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg'];
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg', 'mp4', 'webm', 'ogg']);

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const JS_MIME_TYPES = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'application/javascript',
  'application/x-javascript',
  'text/javascript',
  'application/typescript',
  'text/typescript',
]);

const MARKDOWN_EXTENSIONS = ['.md', '.mdx'];
const MARKDOWN_MIME_TYPES = new Set(['md', 'mdx', 'text/markdown', 'text/x-markdown']);

const TXT_EXTENSIONS = ['.txt'];
const TXT_MIME_TYPES = new Set(['txt', 'text/plain']);

const MSDOC_EXTENSIONS = ['.doc', '.docx', '.odt', '.ppt', '.pptx', '.xls', '.xlsx'];
const MSDOC_MIME_TYPES = new Set([
  'doc',
  'docx',
  'odt',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

// Helper function to check file type
const matchesFileType = (
  fileType: string | undefined,
  fileName: string | undefined,
  extensions: string[],
  mimeTypes: Set<string>,
): boolean => {
  const lowerFileType = fileType?.toLowerCase();
  const lowerFileName = fileName?.toLowerCase();

  // Check MIME type
  if (lowerFileType && mimeTypes.has(lowerFileType)) {
    return true;
  }

  // Check file extension in fileType
  if (lowerFileType && extensions.some((ext) => lowerFileType.includes(ext.slice(1)))) {
    return true;
  }

  // Check file extension in fileName
  if (lowerFileName && extensions.some((ext) => lowerFileName.endsWith(ext))) {
    return true;
  }

  return false;
};

interface FileViewerProps extends FileListItem {
  className?: string;
  style?: CSSProperties;
}

/**
 * Preview any file type.
 */
const FileViewer = memo<FileViewerProps>(({ id, style, fileType, url, name }) => {
  // PDF files
  if (fileType?.toLowerCase() === 'pdf' || name?.toLowerCase().endsWith('.pdf')) {
    return <PDFViewer fileId={id} url={url} />;
  }

  // Image files
  if (matchesFileType(fileType, name, IMAGE_EXTENSIONS, IMAGE_MIME_TYPES)) {
    return <ImageViewer fileId={id} url={url} />;
  }

  // Video files
  if (matchesFileType(fileType, name, VIDEO_EXTENSIONS, VIDEO_MIME_TYPES)) {
    return <VideoViewer fileId={id} url={url} />;
  }

  // JavaScript/TypeScript files
  if (matchesFileType(fileType, name, JS_EXTENSIONS, JS_MIME_TYPES)) {
    return <JavaScriptViewer fileId={id} fileName={name} url={url} />;
  }

  // Markdown files
  if (matchesFileType(fileType, name, MARKDOWN_EXTENSIONS, MARKDOWN_MIME_TYPES)) {
    return <MarkdownViewer fileId={id} url={url} />;
  }

  // Text files
  if (matchesFileType(fileType, name, TXT_EXTENSIONS, TXT_MIME_TYPES)) {
    return <TXTViewer fileId={id} url={url} />;
  }

  // Microsoft Office documents
  if (matchesFileType(fileType, name, MSDOC_EXTENSIONS, MSDOC_MIME_TYPES)) {
    return <MSDocViewer fileId={id} url={url} />;
  }

  // Unsupported file type
  return <NotSupport fileName={name} style={style} url={url} />;
});

export default FileViewer;
