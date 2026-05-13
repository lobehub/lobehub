'use client';

import { memo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { lambdaClient } from '@/libs/trpc/client';
import { useGlobalStore } from '@/store/global';

const ChangelogModal = memo<{ currentId?: string }>(({ currentId: propCurrentId }) => {
  const [latestChangelogId, updateSystemStatus] = useGlobalStore((s) => [
    s.status.latestChangelogId,
    s.updateSystemStatus,
  ]);
  const navigate = useNavigate();
  const [currentId, setCurrentId] = useState(propCurrentId);

  useEffect(() => {
    if (propCurrentId) return;
    lambdaClient.changelog.getIndex
      .query()
      .then((index) => {
        if (index[0]?.id) setCurrentId(index[0].id);
      })
      .catch(() => {});
  }, [propCurrentId]);

  useEffect(() => {
    if (!currentId) return;
    const timer = setTimeout(() => {
      if (!latestChangelogId) {
        updateSystemStatus({ latestChangelogId: currentId });
      } else if (latestChangelogId !== currentId) {
        navigate('/changelog/modal');
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [currentId, latestChangelogId, updateSystemStatus, navigate]);

  return null;
});

export default ChangelogModal;
