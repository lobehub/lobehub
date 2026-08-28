'use client';

import { Center, Empty } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createContext, type ReactNode, use } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { useAcceptanceBundle } from './useAcceptanceBundle';

type AcceptanceScopeValue = {
  acceptanceId: string;
  embedded: boolean;
};

const AcceptanceScopeContext = createContext<AcceptanceScopeValue | null>(null);

export const useAcceptanceScope = () => {
  const scope = use(AcceptanceScopeContext);
  if (!scope) throw new Error('AcceptanceScope is required');
  return scope;
};

export const AcceptanceScope = ({
  acceptanceId,
  children,
  embedded = false,
}: {
  acceptanceId: string;
  children: ReactNode;
  embedded?: boolean;
}) => (
  <AcceptanceScopeContext value={{ acceptanceId, embedded }}>{children}</AcceptanceScopeContext>
);

export const AcceptanceBundleGate = ({
  children,
  height = '100%',
}: {
  children: ReactNode;
  height?: string | number;
}) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, isLoading, mutate } = useAcceptanceBundle(acceptanceId);

  if (isLoading && !data) {
    return (
      <Center height={height}>
        <NeuralNetworkLoading size={48} />
      </Center>
    );
  }

  if (!data) {
    return (
      <Center height={height}>
        <Empty description={t('acceptance.error.description')} title={t('acceptance.error.title')}>
          <Button onClick={() => void mutate()}>{t('report.actions.retry')}</Button>
        </Empty>
      </Center>
    );
  }

  return children;
};
