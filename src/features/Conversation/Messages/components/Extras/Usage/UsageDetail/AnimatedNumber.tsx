import { memo, useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  duration?: number;
  formatter?: (value: number) => string;
  value: number;
}

const AnimatedNumber = memo<AnimatedNumberProps>(({ value, duration = 3000, formatter }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const frameRef = useRef<number>(undefined);
  const startTimeRef = useRef<number>(undefined);
  const startValueRef = useRef(value);

  useEffect(() => {
    const startValue = startValueRef.current;
    const diff = value - startValue;

    if (diff === 0) return;

    const animate = (currentTime: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // 使用 easeOutCubic 缓动函数
      const easeProgress = 1 - (1 - progress) ** 3;
      const current = startValue + diff * easeProgress;

      setDisplayValue(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        startValueRef.current = value;
        startTimeRef.current = undefined;
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [value, duration]);

  return formatter ? formatter(displayValue) : displayValue.toString();
});

export default AnimatedNumber;
