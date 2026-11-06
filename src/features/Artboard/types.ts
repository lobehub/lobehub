export type BoardMode = 'discuss' | 'verify';
export type VerifyView = 'board' | 'flow';

export type CameraTarget =
  | { kind: 'all'; seq: number }
  | { kind: 'journey'; seq: number }
  | { id: string; kind: 'group' | 'item'; seq: number };
