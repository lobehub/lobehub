export const INTEREST_AREA_KEYS = [
  'writing',
  'coding',
  'design',
  'education',
  'business',
  'marketing',
  'product',
  'sales',
  'operations',
  'hr',
  'finance-legal',
  'creator',
  'investing',
  'parenting',
  'health',
  'hobbies',
  'personal',
] as const;

export type InterestAreaKey = (typeof INTEREST_AREA_KEYS)[number];

const interestAreaKeySet = new Set<string>(INTEREST_AREA_KEYS);

export const isInterestAreaKey = (value: string): value is InterestAreaKey =>
  interestAreaKeySet.has(value);
