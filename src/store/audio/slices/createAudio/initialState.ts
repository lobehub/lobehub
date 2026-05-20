export interface AudioTrack {
  audioId: string;
  taskId: string;
  prompt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl?: string;
  imageUrl?: string;
  title?: string;
  duration?: number;
  progress: number;
  createdAt?: Date;
  /** Whether the user can play audio (even if still processing) */
  canPlayEarly: boolean;
  /** Clips returned by the API (multi-track) */
  clips?: Array<{
    id: string;
    status: string;
    audio_url?: string;
    stream_audio_url?: string;
    title?: string;
    image_url?: string;
    duration?: number;
  }>;
}

export interface CreateAudioState {
  /** Currently generating or recently generated tracks, keyed by taskId */
  audioTracks: Record<string, AudioTrack>;
  /** Whether a generation is in progress */
  isGenerating: boolean;
  /** Error from the latest generation attempt */
  generationError: string | null;
}

export const initialCreateAudioState: CreateAudioState = {
  audioTracks: {},
  isGenerating: false,
  generationError: null,
};
