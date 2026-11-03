export interface MinimapIndicator {
  id: string;
  preview: string;
  virtuosoIndex: number;
  width: number;
}

export interface MinimapIndicatorProps {
  activePosition: number | null;
  id: string;
  onJump: (virtuosoIndex: number) => void;
  position: number;
  virtuosoIndex: number;
  width: number;
}
