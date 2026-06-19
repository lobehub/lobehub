import { Flexbox, Text } from '@lobehub/ui';

export default function WorkspaceBillingBilling() {
  return (
    <Flexbox gap={8}>
      <Text weight={600}>Billing</Text>
      <Text type="secondary">
        No hosted billing provider is configured for this self-hosted build.
      </Text>
    </Flexbox>
  );
}
