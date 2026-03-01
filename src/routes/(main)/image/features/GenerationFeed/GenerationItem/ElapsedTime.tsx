'use client';

import { Text } from '@lobehub/ui';
import { useEffect, useRef, useState } from 'react';

interface ElapsedTimeProps {
  generationId: string;
  isActive: boolean;
}

const getSessionStorageKey = (generationId: string) => `generation_start_time_${generationId}`;

/**
 * 显示图片生成的耗时
 * - 少于1分钟：显示秒数，精度0.1秒
 * - 1分钟或以上：显示分钟数，精度1位小数
 * - 使用 sessionStorage 在页面刷新时保持准确计时
 */
export function ElapsedTime({ generationId, isActive }: ElapsedTimeProps) {
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive) {
      // 如果不是活跃状态，清理计时器并重置时间
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      // 清理 sessionStorage 中的数据
      const storageKey = getSessionStorageKey(generationId);
      sessionStorage.removeItem(storageKey);
      setElapsedTime(null);
      return;
    }

    const storageKey = getSessionStorageKey(generationId);

    // 只在组件挂载时设置开始时间
    const clientStartTime = (() => {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) return Number(stored);

      const now = Date.now();
      sessionStorage.setItem(storageKey, now.toString());
      return now;
    })();

    const update = (timestamp: number) => {
      if (timestamp - lastUpdateRef.current >= 100) {
        const elapsed = (Date.now() - clientStartTime) / 100;
        setElapsedTime(Math.max(0, elapsed));
        lastUpdateRef.current = timestamp;
      }
      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [generationId, isActive]);

  // 格式化耗时显示
  const formattedTime = (() => {
    if (elapsedTime === null) return '';

    const totalSeconds = elapsedTime / 10;

    // 少于60秒，显示秒数，精度0.1秒
    if (totalSeconds < 60) {
      return `${totalSeconds.toFixed(1)}s`;
    }

    // 60秒或以上，显示分钟数，精度1位小数
    const minutes = totalSeconds / 60;
    return `${minutes.toFixed(1)}min`;
  })();

  return (
    <Text code fontSize={10} type={'secondary'}>
      {formattedTime}
    </Text>
  );
}
