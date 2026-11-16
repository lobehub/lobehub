import { create } from 'zustand';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { TfsData } from '@/services/tfs';

export interface TfsState {
  data: Record<string, TfsData>;
  replica: ReplicaState<TfsData>;
}
export const initialTfsState = (): TfsState => ({ data: {}, replica: createReplicaState() });
export const useTfsStore = create<TfsState>()(initialTfsState);
