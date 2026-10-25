/** One message of a topic whose text contains the searched keyword. */
export interface TopicMessageSearchMatch {
  createdAt: Date;
  id: string;
  /** Occurrences of the keyword in the message content. */
  matchCount: number;
  role: string;
  /** Whitespace-collapsed excerpt around the first occurrence. */
  snippet: string;
}
