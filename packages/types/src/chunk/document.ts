export interface ChunkDocument {
  compositeId?: string;
  id?: string;
  index: number;
  metadata: any;
  parentId?: string;
  text: string;
  type: string;
}
