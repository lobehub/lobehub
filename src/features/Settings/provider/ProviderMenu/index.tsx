'use client';

import { Flexbox, Icon, SearchBar } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useAiInfraStore } from '@/store/aiInfra/store';

import AddNew from './AddNew';
import ProviderList from './List';
import SearchResult from './SearchResult';

interface ProviderMenuProps {
  children: ReactNode;
  mobile?: boolean;
}
const Layout = memo(({ children, mobile }: ProviderMenuProps) => {
  const { t } = useTranslation('modelProvider');

  const providerSearchKeyword = useAiInfraStore((s) => s.providerSearchKeyword);

  const width = mobile ? undefined : 280;
  return (
    <Flexbox
      width={width}
      style={{
        background: cssVar.colorBgContainer,
        borderRight: `1px solid ${cssVar.colorBorderSecondary}`,
        minWidth: width,
        overflow: mobile ? undefined : 'scroll',
      }}
    >
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        justify={'space-between'}
        padding={8}
        width={'100%'}
        style={{
          background: cssVar.colorBgContainer,
          borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
          marginBottom: 8,
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <SearchBar
          allowClear
          placeholder={t('menu.searchProviders')}
          style={{ width: '100%' }}
          value={providerSearchKeyword}
          variant={'borderless'}
          prefix={
            <Icon
              color={cssVar.colorTextDescription}
              icon={SearchIcon}
              style={{
                marginRight: 12,
              }}
            />
          }
          styles={{
            input: {
              paddingBlock: 3,
              paddingLeft: 6,
            },
          }}
          onInputChange={(v) => {
            useAiInfraStore.setState({ providerSearchKeyword: v });
          }}
        />
        <AddNew />
      </Flexbox>
      {children}
    </Flexbox>
  );
});

const ProviderMenu = ({
  mobile,
  onProviderSelect = () => {},
}: {
  mobile?: boolean;
  onProviderSelect?: (providerKey: string) => void;
}) => {
  const [initAiProviderList, providerSearchKeyword, useFetchAiProviderList] = useAiInfraStore(
    (s) => [s.initAiProviderList, s.providerSearchKeyword, s.useFetchAiProviderList],
  );

  // Own the provider-list fetch here so a failed load surfaces error + Retry
  // instead of a permanent skeleton — `initAiProviderList` only flips on success
  //
  const { error, mutate } = useFetchAiProviderList();

  // Search overrides everything (matches prior behavior); otherwise gate the
  // list on load/error via AsyncBoundary.
  const Content = providerSearchKeyword ? (
    <SearchResult onProviderSelect={onProviderSelect} />
  ) : (
    <AsyncBoundary
      data={initAiProviderList ? true : undefined}
      error={error}
      errorVariant={'page'}
      isLoading={!initAiProviderList && !error}
      loading={<SkeletonList />}
      onRetry={() => mutate()}
    >
      <ProviderList mobile={mobile} onProviderSelect={onProviderSelect} />
    </AsyncBoundary>
  );

  return <Layout mobile={mobile}>{Content}</Layout>;
};

export default ProviderMenu;
