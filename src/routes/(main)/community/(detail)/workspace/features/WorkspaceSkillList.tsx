'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Input, Pagination } from 'antd';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

import SubmitRepoModal from '../../user/features/SubmitRepoModal';
import UserSkillCard from '../../user/features/UserSkillCard';
import { useWorkspaceDetailContext } from './DetailProvider';

interface WorkspaceSkillListProps {
  pageSize?: number;
  rows?: number;
}

const WorkspaceSkillList = memo<WorkspaceSkillListProps>(({ rows = 4, pageSize = 8 }) => {
  const { t } = useTranslation('discover');
  const { skills = [], canEdit, onRefreshProfile } = useWorkspaceDetailContext();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitModalOpen, setSubmitModalOpen] = useState(false);

  const prepareWorkspaceSubmit = useCallback(async () => {
    const { marketAccountId } = await lambdaClient.workspace.ensureMarketOrganization.mutate();
    return { actAs: marketAccountId };
  }, []);

  const filteredSkills = useMemo(() => {
    let list = [...skills];
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter((skill) => {
        const name = skill?.name?.toLowerCase() || '';
        const description = skill?.description?.toLowerCase() || '';
        return name.includes(query) || description.includes(query);
      });
    }
    return list;
  }, [skills, searchQuery]);

  const paginatedSkills = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredSkills.slice(startIndex, startIndex + pageSize);
  }, [filteredSkills, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  if (skills.length === 0 && !canEdit) return null;

  const showPagination = filteredSkills.length > pageSize;

  return (
    <>
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text fontSize={16} weight={500}>
              {t('user.skills')}
            </Text>
            {skills.length > 0 && <Tag>{filteredSkills.length}</Tag>}
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8}>
            {canEdit && skills.length > 0 && (
              <Input.Search
                allowClear
                placeholder={t('user.searchPlaceholder')}
                style={{ width: 200 }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            )}
            {/* Skill upload to community is temporarily disabled
            {canEdit && (
              <Button icon={<Plus size={14} />} onClick={() => setSubmitModalOpen(true)}>
                {t('user.submitRepo')}
              </Button>
            )} */}
          </Flexbox>
        </Flexbox>
        {skills.length > 0 ? (
          <Grid rows={rows} width={'100%'}>
            {paginatedSkills.map((item, index) => (
              <UserSkillCard key={item.identifier || index} {...item} />
            ))}
          </Grid>
        ) : (
          <Flexbox align={'center'} justify={'center'} style={{ minHeight: 120, opacity: 0.5 }}>
            <Text type={'secondary'}>{t('user.noSkills')}</Text>
          </Flexbox>
        )}
        {showPagination && (
          <Flexbox align={'center'} justify={'center'}>
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              showSizeChanger={false}
              total={filteredSkills.length}
              onChange={(page) => setCurrentPage(page)}
            />
          </Flexbox>
        )}
      </Flexbox>
      <SubmitRepoModal
        beforeSubmit={prepareWorkspaceSubmit}
        open={submitModalOpen}
        onClose={() => setSubmitModalOpen(false)}
        onSuccess={onRefreshProfile}
      />
    </>
  );
});

export default WorkspaceSkillList;
