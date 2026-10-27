import { ActionIcon, Button } from '@lobehub/ui-rn';
import { Trash2 } from 'lucide-react-native';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { createStyles } from '@/theme';

const useStyles = createStyles((token) => ({
  title: { color: token.colorText, fontFamily: 'Inter', fontSize: token.fontSizeLG },
}));

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, padding: 12 },
});

export const ChatList = ({ items, onClear }: { items: { id: string; title: string }[]; onClear: () => void }) => {
  const s = useStyles();
  return (
    <View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={s.title}>{item.title}</Text>
            <ActionIcon accessibilityLabel="删除会话" icon={Trash2} />
          </View>
        )}
      />
      <Button onPress={onClear}>清除缓存</Button>
    </View>
  );
};
