'use client';

import { ContextMenuTrigger, Flexbox, type MenuProps } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Text,
} from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ArrowDownUpIcon } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { aiProviderSelectors } from '@/store/aiInfra';
import { useAiInfraStore } from '@/store/aiInfra/store';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Actions from './Actions';
import All from './All';
import ProviderItem from './Item';
import SortProviderModal from './SortProviderModal';
import { SortType, useProviderDropdownMenu } from './useDropdownMenu';

interface ProviderSectionProps {
  action?: ReactNode;
  children: ReactNode;
  contextMenuItems: MenuProps['items'];
  title: string;
  value: string;
}

const ProviderSection = ({
  action,
  children,
  contextMenuItems,
  title,
  value,
}: ProviderSectionProps) => (
  <AccordionItem value={value}>
    <ContextMenuTrigger items={contextMenuItems}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {title}
          </Text>
        </AccordionTrigger>
        {action && (
          <div
            className={cx(
              'accordion-action',
              accordionStyles.action,
              accordionStyles.actionBorderless,
            )}
          >
            {action}
          </div>
        )}
      </AccordionHeader>
    </ContextMenuTrigger>
    <AccordionPanel>
      <Flexbox gap={4} paddingBlock={1}>
        {children}
      </Flexbox>
    </AccordionPanel>
  </AccordionItem>
);

const ProviderList = (props: {
  mobile?: boolean;
  onProviderSelect: (providerKey: string) => void;
}) => {
  const { onProviderSelect, mobile } = props;
  const { t } = useTranslation('modelProvider');
  const [open, setOpen] = useState(false);

  // Accordion states - using array of active keys
  const [expandedKeys, setExpandedKeys] = useState<string[]>(['enabled', 'custom', 'disabled']);

  const [sortType, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.disabledModelProvidersSortType(s),
    s.updateSystemStatus,
  ]);

  const updateSortType = useCallback(
    (newSortType: SortType) => {
      updateSystemStatus({ disabledModelProvidersSortType: newSortType });
    },
    [updateSystemStatus],
  );

  const dropdownMenu = useProviderDropdownMenu({
    onSortChange: updateSortType,
    sortType: (sortType || SortType.Default) as SortType,
  });

  const enabledModelProviderList = useAiInfraStore(
    aiProviderSelectors.enabledAiProviderList,
    isEqual,
  );

  const disabledModelProviderList = useAiInfraStore(
    aiProviderSelectors.disabledAiProviderList,
    isEqual,
  );

  const disabledCustomProviderList = useAiInfraStore(
    aiProviderSelectors.disabledCustomAiProviderList,
    isEqual,
  );

  // Sort model providers based on sort type
  const sortedDisabledProviders = useMemo(() => {
    const providers = [...disabledModelProviderList];
    const currentSortType = (sortType || SortType.Default) as SortType;
    switch (currentSortType) {
      case SortType.Alphabetical: {
        return providers.sort((a, b) => {
          const cmpDisplay = (a.name || a.id).localeCompare(b.name || b.id);
          if (cmpDisplay !== 0) return cmpDisplay;
          return a.id.localeCompare(b.id);
        });
      }
      case SortType.AlphabeticalDesc: {
        return providers.sort((a, b) => {
          const cmpDisplay = (b.name || a.id).localeCompare(a.name || b.id);
          if (cmpDisplay !== 0) return cmpDisplay;
          return b.id.localeCompare(a.id);
        });
      }
      case SortType.Default: {
        return providers;
      }
    }
  }, [disabledModelProviderList, sortType]);

  const canSortDisabled = disabledModelProviderList.length > 1;

  return (
    <Flexbox gap={4} paddingInline={4} style={{ paddingBottom: 32 }}>
      {!mobile && <All onClick={onProviderSelect} />}
      {open && (
        <SortProviderModal
          defaultItems={enabledModelProviderList}
          open={open}
          onCancel={() => {
            setOpen(false);
          }}
        />
      )}
      <AccordionRoot
        indicatorPlacement="inline"
        value={expandedKeys}
        onValueChange={(keys) => setExpandedKeys(keys as string[])}
      >
        <ProviderSection
          contextMenuItems={[]}
          title={t('menu.list.enabled')}
          value="enabled"
          action={
            <ActionIcon
              icon={ArrowDownUpIcon}
              size={'small'}
              title={t('menu.sort')}
              onClick={() => setOpen(true)}
            />
          }
        >
          {enabledModelProviderList.map((item) => (
            <ProviderItem {...item} key={item.id} onClick={onProviderSelect} />
          ))}
        </ProviderSection>

        {disabledCustomProviderList.length > 0 && (
          <ProviderSection contextMenuItems={[]} title={t('menu.list.custom')} value="custom">
            {disabledCustomProviderList.map((item) => (
              <ProviderItem {...item} key={item.id} onClick={onProviderSelect} />
            ))}
          </ProviderSection>
        )}

        <ProviderSection
          action={canSortDisabled ? <Actions dropdownMenu={dropdownMenu} /> : undefined}
          contextMenuItems={canSortDisabled ? dropdownMenu : []}
          title={t('menu.list.disabled')}
          value="disabled"
        >
          {sortedDisabledProviders.map((item) => (
            <ProviderItem {...item} key={item.id} onClick={onProviderSelect} />
          ))}
        </ProviderSection>
      </AccordionRoot>
    </Flexbox>
  );
};

export default ProviderList;
