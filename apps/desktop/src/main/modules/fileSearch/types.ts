export interface FileResult {
  contentType?: string;
  createdTime: Date;
  // Search engine used to find this file (e.g., 'mdfind', 'fd', 'find', 'fast-glob')
  engine?: string;
  isDirectory: boolean;
  lastAccessTime: Date;
  // Spotlight specific metadata
  metadata?: {
    [key: string]: any;
  };
  modifiedTime: Date;
  name: string;
  path: string;
  size: number;
  type: string;
}

export interface SearchOptions {
  // Directory options
  // Content options
  contentContains?: string;
  // Created after specific date
  createdAfter?: Date;

  // Created before specific date
  createdBefore?: Date;
  // Whether to return detailed results
  detailed?: boolean;

  // Limit search to specific directories
  exclude?: string[]; // Files containing specific content

  // File type options
  fileTypes?: string[];

  // Basic options
  keywords: string;
  limit?: number;
  // Created before specific date
  // Advanced options
  liveUpdate?: boolean;
  // File type filters, like "public.image", "public.movie"
  // Time options
  modifiedAfter?: Date;

  // Modified after specific date
  modifiedBefore?: Date;
  // Path options
  onlyIn?: string; // Whether to return detailed metadata
  sortBy?: 'name' | 'date' | 'size'; // Result sorting
  sortDirection?: 'asc' | 'desc'; // Sort direction
}
