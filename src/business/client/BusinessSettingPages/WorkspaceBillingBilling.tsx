import { Flexbox, Text } from '@lobehub/ui';

export default function WorkspaceBillingBilling() {
  return (
    <Flexbox gap={8}>
      <Text weight={600}>Биллинг</Text>
      <Text type="secondary">В этой self-hosted сборке внешний биллинг не используется.</Text>
    </Flexbox>
  );
}
