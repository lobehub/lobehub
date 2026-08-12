'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { StyleSheet } from '@/utils/styles';

import GroupBreadcrumb from './GroupBreadcrumb';
import PermissionForm from './PermissionForm';

const styles = StyleSheet.create({
  body: {
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
});

const GroupPermission = memo(() => {
  const { t } = useTranslation('setting');
  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  // The group row itself is what the form reads (visibility / workspace); until
  // it lands the page would otherwise render the personal-group empty state,
  // which is a different fact.
  const isGroupLoading = useAgentGroupStore(agentGroupSelectors.isGroupsInit);

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          activeGroupId ? (
            <GroupBreadcrumb groupId={activeGroupId} title={t('permission.page.title')} />
          ) : null
        }
      />
      <Flexbox flex={1} style={styles.body} width={'100%'}>
        <WideScreenContainer>
          <Flexbox gap={16} paddingBlock={16}>
            <AsyncBoundary
              data={isGroupLoading ? undefined : true}
              isLoading={isGroupLoading}
              loading={<SurfaceSkeleton header={false} variant={'form'} />}
            >
              <PermissionForm groupId={activeGroupId ?? ''} />
            </AsyncBoundary>
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

GroupPermission.displayName = 'GroupPermission';

export default GroupPermission;
