export interface MinimapIndicator {
  id: string;
  preview: string;
  role: 'user' | 'assistant';
  virtuosoIndex: number;
  width: number;
}

export interface MinimapIndicatorProps {
  activePosition: number | null;
  id: string;
  onJump: (virtuosoIndex: number) => void;
  position: number;
  preview: string;
  role: 'user' | 'assistant';
  virtuosoIndex: number;
  width: number;
}
