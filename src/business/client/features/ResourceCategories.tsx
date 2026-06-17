import type { LucideIcon } from 'lucide-react';

export interface BusinessResourceCategory {
  icon: LucideIcon;
  key: string;
  titleKey: string;
  url: string;
}

export function useBusinessResourceCategories(): BusinessResourceCategory[] {
  return [];
}
