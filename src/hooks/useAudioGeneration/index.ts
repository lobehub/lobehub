'use client';

import { useCallback, useState } from 'react';

import { useAudioStore } from '@/store/audio';

interface GenerateAudioParams {
  prompt: string;
  musicStyle: string;
  duration: number;
}

export const useGenerateAudio = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addGenerationBatch = useAudioStore((s) => s.addGenerationBatch);
  const activeTopicId = useAudioStore((s) => s.activeGenerationTopicId);

  const generateAudio = useCallback(
    async (params: GenerateAudioParams) => {
      if (!activeTopicId) {
        setError('No active topic');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        // TODO: Call TRPC API to generate audio
        console.log('Generating audio:', params);
        
        // Placeholder batch structure
        const batch = {
          id: `batch-${Date.now()}`,
          prompt: params.prompt,
          model: 'suno-v5.5',
          provider: 'suno',
          config: {
            musicStyle: params.musicStyle,
            duration: params.duration,
            prompt: params.prompt,
          },
          generations: [{
            id: `gen-${Date.now()}`,
            asyncTaskId: null,
            createdAt: new Date(),
            task: { id: '', status: 'pending' },
          }],
          createdAt: new Date(),
        };

        addGenerationBatch(activeTopicId, batch);
        return batch;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Generation failed';
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [activeTopicId, addGenerationBatch],
  );

  return { generateAudio, loading, error };
};
