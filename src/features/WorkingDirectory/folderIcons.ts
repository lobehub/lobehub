import {
  DownloadIcon,
  FilesIcon,
  FolderIcon,
  ImageIcon,
  LayoutGridIcon,
  LibraryIcon,
  type LucideIcon,
  MonitorIcon,
  MusicIcon,
  VideoIcon,
} from 'lucide-react';

const WELL_KNOWN_FOLDER_ICONS: Record<string, LucideIcon> = {
  applications: LayoutGridIcon,
  desktop: MonitorIcon,
  documents: FilesIcon,
  downloads: DownloadIcon,
  library: LibraryIcon,
  movies: VideoIcon,
  music: MusicIcon,
  pictures: ImageIcon,
  videos: VideoIcon,
};

/** Icon for a browsed folder: a purpose glyph for the well-known home
 * subdirectories (Downloads, Documents, …), a plain folder otherwise. */
export const getFolderIcon = (name: string): LucideIcon =>
  WELL_KNOWN_FOLDER_ICONS[name.toLowerCase()] ?? FolderIcon;
