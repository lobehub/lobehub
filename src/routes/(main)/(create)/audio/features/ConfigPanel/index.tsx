'use client';

import { Flexbox } from '@lobehub/ui';
import { Divider, Input, Select, Slider } from 'antd';
import { memo, useCallback } from 'react';

import { useAudioStore } from '@/store/audio';

const MUSIC_STYLES = [
  { value: 'ambient', label: 'Ambient' },
  { value: 'pop', label: 'Pop' },
  { value: 'rock', label: 'Rock' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'lo-fi', label: 'Lo-Fi' },
  { value: 'classical', label: 'Classical' },
  { value: 'hip-hop', label: 'Hip-Hop' },
];

const ConfigPanel = memo(() => {
  const musicStyle = useAudioStore((s) => s.musicStyle);
  const duration = useAudioStore((s) => s.duration);
  const setMusicStyle = useAudioStore((s) => s.setMusicStyle);
  const setDuration = useAudioStore((s) => s.setDuration);

  const handleStyleChange = useCallback(
    (value: string) => {
      setMusicStyle(value);
    },
    [setMusicStyle],
  );

  const handleDurationChange = useCallback(
    (value: number | [number] | [number, number] | null) => {
      if (typeof value === 'number') {
        setDuration(value);
      }
    },
    [setDuration],
  );

  return (
    <Flexbox gap="md" padding="md">
      <div>
        <label>Model Version</label>
        <Input disabled value="v5.5" />
      </div>

      <Divider />

      <div>
        <label>Music Style</label>
        <Select
          options={MUSIC_STYLES}
          style={{ width: '100%' }}
          value={musicStyle}
          onChange={handleStyleChange}
        />
      </div>

      <div>
        <label>Duration (seconds)</label>
        <Flexbox align="center" gap="sm">
          <Slider
            max={120}
            min={15}
            style={{ flex: 1 }}
            value={duration}
            onChange={handleDurationChange}
          />
          <span>{duration}s</span>
        </Flexbox>
      </div>
    </Flexbox>
  );
});

ConfigPanel.displayName = 'AudioConfigPanel';

export default ConfigPanel;
