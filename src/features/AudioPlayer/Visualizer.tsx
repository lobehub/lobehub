'use client';

import { memo, useEffect, useRef } from 'react';

interface VisualizerProps {
  isPlaying: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
}

const Visualizer = memo<VisualizerProps>(({ isPlaying, audioRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationIdRef = useRef<number>();
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!audioRef.current || !isPlaying) return;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;
      
      if (!analyserRef.current) {
        const source = audioContext.createMediaElementAudioSource(audioRef.current);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      }

      const draw = () => {
        if (!canvasRef.current || !analyserRef.current || !dataArrayRef.current) return;

        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        const dataArray = dataArrayRef.current;
        const ctx = canvas.getContext('2d');

        if (!ctx) return;

        analyser.getByteFrequencyData(dataArray);

        ctx.fillStyle = 'rgba(200, 200, 200, 0.1)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'rgb(100, 150, 255)';
        const barWidth = (canvas.width / dataArray.length) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
          barHeight = (dataArray[i] / 255) * canvas.height;
          ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
          x += barWidth + 1;
        }

        if (isPlaying) {
          animationIdRef.current = requestAnimationFrame(draw);
        }
      };

      draw();
    } catch (error) {
      console.error('Visualizer error:', error);
    }

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, [isPlaying, audioRef]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={100}
      style={{
        width: '100%',
        height: '100px',
        border: '1px solid var(--colorBorder)',
        borderRadius: '4px',
        backgroundColor: 'rgba(0, 0, 0, 0.02)',
      }}
    />
  );
});

Visualizer.displayName = 'Visualizer';

export default Visualizer;
