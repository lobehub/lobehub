export interface QuickNoteAnnotation {
  content: string;
  divedAt?: number;
}

export interface QuickNoteItem {
  annotation?: QuickNoteAnnotation;
  collection?: string;
  content: string;
  createdAt: number;
  id: string;
  location?: string;
  tags: string[];
  updatedAt: number;
}
