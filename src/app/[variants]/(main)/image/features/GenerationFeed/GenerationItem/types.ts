import type {Generation, GenerationBatch} from '@/types/generation';

export interface GenerationItemProps {
  generation: Generation;
  generationBatch: GenerationBatch;
  prompt: string;
}

export interface ActionButtonsProps {
  onCopySeed?: () => void;
  onDelete: () => void;
  onDownload?: () => void;
  seedTooltip?: string;
  showCopySeed?: boolean;
  showDownload?: boolean;
}

export interface SuccessStateProps {
  aspectRatio: string;
  generation: Generation;
  generationBatch: GenerationBatch;
  onCopySeed?: () => void;
  onDelete: () => void;
  onDownload: () => void;
  prompt: string;
  seedTooltip?: string;
}

export interface ErrorStateProps {
  aspectRatio: string;
  generation: Generation;
  generationBatch: GenerationBatch;
  onCopyError: () => void;
  onDelete: () => void;
}

export interface LoadingStateProps {
  aspectRatio: string;
  generation: Generation;
  generationBatch: GenerationBatch;
  onDelete: () => void;
}
