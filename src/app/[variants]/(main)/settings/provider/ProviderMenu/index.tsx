'use client';

import { Flexbox, Icon, SearchBar } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';

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

  const [providerSearchKeyword, useFetchAiProviderList] = useAiInfraStore((s) => [
    s.providerSearchKeyword,
    s.useFetchAiProviderList,
    s.initAiProviderList,
  ]);

  useFetchAiProviderList();

  const width = mobile ? undefined : 280;
  return (
    <Flexbox
      style={{
        background: cssVar.colorBgContainer,
        borderRight: `1px solid ${cssVar.colorBorderSecondary}`,
        minWidth: width,
        overflow: mobile ? undefined : 'scroll',
      }}
      width={width}
    >
      <Flexbox
        align={'center'}
        gap={8}
        horizontal
        justify={'space-between'}
        padding={8}
        style={{
          background: cssVar.colorBgContainer,
          borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
          marginBottom: 8,
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
        width={'100%'}
      >
        <SearchBar
          allowClear
          defaultValue={providerSearchKeyword}
          onInputChange={(v) => {
            if (!v) useAiInfraStore.setState({ providerSearchKeyword: '' });
          }}
          onSearch={(v) => useAiInfraStore.setState({ providerSearchKeyword: v })}
          placeholder={t('menu.searchProviders')}
          prefix={
            <Icon
              color={cssVar.colorTextDescription}
              icon={SearchIcon}
              style={{
                marginRight: 12,
              }}
            />
          }
          style={{ width: '100%' }}
          styles={{
            input: {
              paddingBlock: 3,
              paddingLeft: 6,
            },
          }}
          variant={'borderless'}
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
  const [initAiProviderList, providerSearchKeyword] = useAiInfraStore((s) => [
    s.initAiProviderList,
    s.providerSearchKeyword,
  ]);

  let Content = <ProviderList mobile={mobile} onProviderSelect={onProviderSelect} />;

  // loading
  if (!initAiProviderList) Content = <SkeletonList />;

  // search
  if (!!providerSearchKeyword) Content = <SearchResult onProviderSelect={onProviderSelect} />;

  return <Layout mobile={mobile}>{Content}</Layout>;
};

export default ProviderMenu;
