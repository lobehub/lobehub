export type BoardMode = 'discuss' | 'verify';
export type VerifyView = 'board' | 'list';
export type BoardTool = 'comment' | 'select';
export type CompareView = 'design' | 'real' | 'split';

export type CameraTarget =
  | { kind: 'all'; seq: number }
  | { kind: 'journey'; seq: number }
  | { id: string; kind: 'group' | 'item'; seq: number };
