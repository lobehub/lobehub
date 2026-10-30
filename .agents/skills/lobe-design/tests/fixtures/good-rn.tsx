// lobe-design-platform: mobile
// RN：createStyles 来自项目主题、fontFamily / outline 是 RN 样式、ui-rn 是原子层、图标按钮用 accessibilityLabel
import { ActionIcon, Button } from '@lobehub/ui-rn';
import type { ThemeConfig } from '@lobehub/ui';
import { useTheme as useWebTheme } from '@lobehub/ui';
import { colorScales } from '@lobehub/ui/es/styles';
import { preprocessMarkdownContent } from '@lobehub/ui/es/hooks/useMarkdown/utils';
import { Trash2 } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { createStyles, useTheme } from '@/theme';

const useStyles = createStyles((token) => ({
  title: { color: token.colorText, fontFamily: 'PingFang SC' },
}));

const styles = StyleSheet.create({ row: { gap: 8, outline: 'none', padding: 12 } });

export const Modal = ({ onClear, theme }: { onClear: () => void; theme?: ThemeConfig }) => {
  const s = useStyles();
  const t = useTheme();
  return (
    <View style={[styles.row, { borderColor: t.colorBorder }]}>
      <Text style={s.title}>会话</Text>
      <ActionIcon accessibilityLabel="删除会话" icon={Trash2} />
      <Button onPress={onClear}>清除缓存</Button>
    </View>
  );
};
