export interface UserMemorySource {
  createdAt: Date;
  id: string;
  metadata?: Record<string, unknown>;
  sampleId?: string;
  sourceType: string;
  updatedAt: Date;
  userId: string;
}
