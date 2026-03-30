'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import { Button, Input, Pagination } from 'antd';
import { Plus } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserDetailContext } from './DetailProvider';
import SubmitRepoModal from './SubmitRepoModal';
import UserSkillCard from './UserSkillCard';

interface UserSkillListProps {
  pageSize?: number;
  rows?: number;
}

const UserSkillList = memo<UserSkillListProps>(({ rows = 4, pageSize = 8 }) => {
  const { t } = useTranslation('discover');
  const { skills = [], isOwner } = useUserDetailContext();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitModalOpen, setSubmitModalOpen] = useState(false);

  const filteredSkills = useMemo(() => {
    let allSkills = [...skills];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      allSkills = allSkills.filter((skill) => {
        const name = skill?.name?.toLowerCase() || '';
        const description = skill?.description?.toLowerCase() || '';
        return name.includes(query) || description.includes(query);
      });
    }

    return allSkills;
  }, [skills, searchQuery]);

  const paginatedSkills = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredSkills.slice(startIndex, startIndex + pageSize);
  }, [filteredSkills, currentPage, pageSize]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  if (skills.length === 0 && !isOwner) return null;

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
            {isOwner && skills.length > 0 && (
              <Input.Search
                allowClear
                placeholder={t('user.searchPlaceholder')}
                style={{ width: 200 }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            )}
            {isOwner && (
              <Button icon={<Plus size={14} />} onClick={() => setSubmitModalOpen(true)}>
                {t('user.submitRepo')}
              </Button>
            )}
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
      <SubmitRepoModal open={submitModalOpen} onClose={() => setSubmitModalOpen(false)} />
    </>
  );
});

export default UserSkillList;
