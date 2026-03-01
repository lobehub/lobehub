import { useTheme } from 'antd-style';
import { darken, lighten, mix, rgba, saturate } from 'polished';
import { useMemo } from 'react';

function getStableRandom(str: string, min = 0, max = 100) {
  if (min > max) {
    return 0;
  }

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  hash = Math.abs(hash);
  const range = max - min + 1;
  return min + (hash % range);
}

export const useCateColor = (cate?: string | null) => {
  const theme = useTheme();

  const colors = [
    theme.volcano,
    theme.orange,
    theme.gold,
    theme.green,
    theme.cyan,
    theme.blue,
    theme.geekblue,
    theme.purple,
    theme.magenta,
    theme.pink,
  ];

  return useMemo(() => {
    if (!cate) return undefined;
    const index = getStableRandom(cate, 0, colors.length - 1);
    const color = saturate(
      theme.isDarkMode ? 0.25 : 0.5,
      mix(
        theme.isDarkMode ? 0.06 : 0.05,
        colors[index],
        theme.isDarkMode ? theme.colorBgContainer : theme.colorBgLayout,
      ),
    );
    return {
      backgroundColor: color,
      backgroundTextColor: theme.isDarkMode ? lighten(0.5, color) : darken(0.5, color),
      color: theme.isDarkMode ? lighten(0.4, color) : darken(0.6, color),
      shadowColor: rgba(darken(0.6, color), theme.isDarkMode ? 0.5 : 0.2),
    };
  }, [cate, colors, theme]);
};
