import { Flexbox, Text } from '@lobehub/ui';

export default function WorkspaceBillingCredits() {
  return (
    <Flexbox gap={8}>
      <Text weight={600}>Credits</Text>
      <Text type="secondary">
        Credits are not required when using your own model provider keys.
      </Text>
    </Flexbox>
  );
}
