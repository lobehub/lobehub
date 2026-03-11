import { z } from 'zod';

export type SearchMode = 'off' | 'auto' | 'on';

export enum ModelSearchImplement {
  /**
   * Model has built-in search functionality
   * Similar to search modes of models like Jina, PPLX, transparent to the caller
   */
  Internal = 'internal',
  /**
   * Uses parameter toggle approach, e.g. Qwen, Google, OpenRouter, search results in
   */
  Params = 'params',
  /**
   * Uses tool calling approach
   */
  Tool = 'tool',
}

export interface CitationItem {
  favicon?: string;
  id?: string;
  title?: string;
  url: string;
}

export interface ImageCitationItem {
  domain?: string;
  imageUri?: string;
  sourceUri?: string;
  title?: string;
}

export interface GroundingSearch {
  citations?: CitationItem[];
  imageResults?: ImageCitationItem[];
  imageSearchQueries?: string[];
  searchQueries?: string[];
}

export const ImageCitationItemSchema = z.object({
  domain: z.string().optional(),
  imageUri: z.string().optional(),
  sourceUri: z.string().optional(),
  title: z.string().optional(),
});

export const GroundingSearchSchema = z.object({
  citations: z
    .array(
      z.object({
        favicon: z.string().optional(),
        id: z.string().optional(),
        title: z.string().optional(),
        url: z.string(),
      }),
    )
    .optional(),
  imageResults: z.array(ImageCitationItemSchema).optional(),
  imageSearchQueries: z.array(z.string()).optional(),
  searchQueries: z.array(z.string()).optional(),
});
