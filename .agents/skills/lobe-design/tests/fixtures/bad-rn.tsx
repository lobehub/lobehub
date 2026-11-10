// lobe-design-platform: mobile
// RN 回归：web 专属规则不报；RN 专属与跨平台规则照常报
import { Button } from '@lobehub/ui'; // expect: LOBE-RN-DOM-UI
import Markdown from '@lobehub/ui/es/Markdown'; // expect: LOBE-RN-DOM-UI
import { StyleSheet, View } from 'react-native';
import { ActionIcon } from '@lobehub/ui-rn';
import { Trash2 } from 'lucide-react-native';

const styles = StyleSheet.create({
  root: { backgroundColor: '#ff0000' }, // expect: LOBE-RAW-COLOR
});

export const Bad = () => (
  <View style={styles.root}>
    <Button>清除缓存</Button>
    <Markdown>{'**hi**'}</Markdown>
    <ActionIcon icon={Trash2} /> {/* expect: LOBE-ICON-BUTTON-LABEL */}
  </View>
);
