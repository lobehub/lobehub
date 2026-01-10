export interface TreeItem {
  children?: TreeItem[];
  fileType: string;
  id: string;
  isFolder: boolean;
  name: string;
  slug?: string | null;
  sourceType?: string;
  url: string;
}
