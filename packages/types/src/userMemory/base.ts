export interface UserMemory {
  accessedAt: Date;
  accessedCount: number | null;
  capturedAt: Date;
  createdAt: Date;
  details: string | null;
  detailsVector1024: number[] | null;
  id: string;
  lastAccessedAt: Date;
  memoryCategory: string | null;
  memoryLayer: string | null;
  memoryType: string | null;
  metadata: Record<string, unknown> | null;
  status: string | null;
  summary: string | null;
  summaryVector1024: number[] | null;
  tags: string[] | null;
  title: string | null;
  updatedAt: Date;
  userId: string | null;
}

export type UserMemoryWithoutVectors = Omit<
  UserMemory,
  'summaryVector1024' | 'detailsVector1024'
>;

export type UserMemoryListItem = Omit<
  UserMemoryWithoutVectors,
  'details' | 'summary' | 'capturedAt'
>;
