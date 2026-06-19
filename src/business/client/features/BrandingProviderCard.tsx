import { Flexbox, Text } from '@lobehub/ui';

export function BrandingProviderCard() {
  return (
    <Flexbox
      gap={4}
      padding={12}
      style={{ border: '1px solid var(--lobe-color-border-secondary)', borderRadius: 8 }}
    >
      <Text weight={600}>Acensus AI</Text>
      <Text type="secondary">Единый in-house провайдер поверх настроенных upstream моделей.</Text>
    </Flexbox>
  );
}
