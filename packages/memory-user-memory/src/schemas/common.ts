import { TypesEnum } from '@lobechat/types';
import { z } from 'zod';

/**
 * Memory category values
 */
export const MEMORY_CATEGORIES = [
  'work',
  'personal',
  'health',
  'finance',
  'education',
  'entertainment',
  'travel',
  'relationships',
  'hobbies',
  'goals',
] as const;

/**
 * Memory type values
 */
export const MEMORY_TYPES = [
  'preference',
  'fact',
  'context',
  'activity',
  'event',
  'location',
  'people',
  'topic',
  'technology',
  'other',
] as const;

/**
 * Memory type enum
 */
export const memoryTypeValues = Object.values(TypesEnum) as [TypesEnum, ...TypesEnum[]];
export const MemoryTypeSchema = z.nativeEnum(TypesEnum);

export type MemoryType = z.infer<typeof MemoryTypeSchema>;
