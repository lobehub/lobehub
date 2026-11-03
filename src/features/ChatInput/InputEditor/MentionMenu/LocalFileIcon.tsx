import { Icon } from '@lobehub/ui';
import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  Folder,
  type LucideIcon,
} from 'lucide-react';
import { memo } from 'react';

import { getFileExtension } from './localFileDisplay';

const CODE_EXTENSIONS = new Set([
  'c',
  'cpp',
  'cs',
  'css',
  'go',
  'html',
  'java',
  'js',
  'jsx',
  'kt',
  'lua',
  'mjs',
  'php',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'swift',
  'ts',
  'tsx',
  'vue',
  'yaml',
  'yml',
]);

const IMAGE_EXTENSIONS = new Set(['gif', 'heic', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const TEXT_EXTENSIONS = new Set(['csv', 'log', 'md', 'mdx', 'rtf', 'txt']);
const ARCHIVE_EXTENSIONS = new Set(['7z', 'gz', 'rar', 'tar', 'tgz', 'zip']);

const resolveIcon = (name: string, isDirectory?: boolean): LucideIcon => {
  if (isDirectory) return Folder;

  const extension = getFileExtension(name);
  if (CODE_EXTENSIONS.has(extension)) return FileCode;
  if (IMAGE_EXTENSIONS.has(extension)) return FileImage;
  if (TEXT_EXTENSIONS.has(extension)) return FileText;
  if (ARCHIVE_EXTENSIONS.has(extension)) return FileArchive;

  return File;
};

interface LocalFileIconProps {
  isDirectory?: boolean;
  name: string;
}

const LocalFileIcon = memo<LocalFileIconProps>(({ name, isDirectory }) => (
  <Icon icon={resolveIcon(name, isDirectory)} size={16} />
));

LocalFileIcon.displayName = 'LocalFileIcon';

export default LocalFileIcon;
