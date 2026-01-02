/**
 * Identity data structure for chat context injection
 * This is the subset of fields returned by queryIdentitiesForInjection API
 */
export interface IdentityForInjection {
  /** When the identity was captured/observed */
  capturedAt: Date;
  createdAt: Date;
  description: string | null;
  id: string;
  role: string | null;
  type: string | null;
  updatedAt: Date;
}
