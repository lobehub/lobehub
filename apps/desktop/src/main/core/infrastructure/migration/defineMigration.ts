import type Store from 'electron-store';

import type { ElectronMainStore } from '@/types/store';

export interface StoreMigration {
  id: string;
  up: (store: Store<ElectronMainStore>) => void;
}

export const defineMigration = (migration: StoreMigration): StoreMigration => migration;
