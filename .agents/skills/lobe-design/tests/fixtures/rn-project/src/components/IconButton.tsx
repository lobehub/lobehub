import { ActionIcon } from '@lobehub/ui-rn';

export const IconButton = (props: { icon: any; label: string; onPress?: () => void }) => (
  <ActionIcon accessibilityLabel={props.label} icon={props.icon} onPress={props.onPress} />
);
