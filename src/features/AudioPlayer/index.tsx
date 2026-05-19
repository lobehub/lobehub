'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Slider } from 'antd';
import { memo, useRef, useState, useEffect, useCallback } from 'react';
import { MdDownload, MdPause, MdPlayArrow, MdVolumeUp } from 'react-icons/md';

import Visualizer from './Visualizer';

interface AudioPlayerProps {
  audioUrl: string;
  fileName?: string;
}

const AudioPlayer = memo<AudioPlayerProps>(({ audioUrl, fileName }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const handlePlayPause = useCallback(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const handleProgressChange = useCallback((value: number | [number] | [number, number] | null) => {
    if (typeof value === 'number' && audioRef.current) {
      audioRef.current.currentTime = value;
      setCurrentTime(value);
    }
  }, []);

  const handleVolumeChange = useCallback((value: number | [number] | [number, number] | null) => {
    if (typeof value === 'number' && audioRef.current) {
      audioRef.current.volume = value / 100;
      setVolume(value);
    }
  }, []);

  const handleDownload = useCallback(() => {
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = fileName || 'audio.mp3';
    a.click();
  }, [audioUrl, fileName]);

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  return (
    <Flexbox gap="md" padding="md">
      <audio ref={audioRef} src={audioUrl} crossOrigin="anonymous" />

      <Visualizer
        isPlaying={isPlaying}
        audioRef={audioRef}
      />

      <Flexbox gap="sm">
        <Button
          icon={isPlaying ? <MdPause /> : <MdPlayArrow />}
          onClick={handlePlayPause}
          type="primary"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </Button>
        <Button icon={<MdDownload />} onClick={handleDownload}>
          Download
        </Button>
      </Flexbox>

      <Flexbox gap="sm">
        <span>{formatTime(currentTime)}</span>
        <Slider
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleProgressChange}
          style={{ flex: 1 }}
        />
        <span>{formatTime(duration)}</span>
      </Flexbox>

      <Flexbox horizontal gap="sm" align="center">
        <MdVolumeUp />
        <Slider
          min={0}
          max={100}
          value={volume}
          onChange={handleVolumeChange}
          style={{ width: '100px' }}
        />
      </Flexbox>
    </Flexbox>
  );
});

AudioPlayer.displayName = 'AudioPlayer';

export default AudioPlayer;
