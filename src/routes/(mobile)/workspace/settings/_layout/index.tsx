'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import MobileContentLayout from '@/components/server/MobileNavLayout';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

const titleMap: Record<string, string> = {
  'apikey': 'API ключи workspace',
  'billing': 'Биллинг workspace',
  'credits': 'Кредиты workspace',
  'creds': 'Credentials workspace',
  'general': 'Основное',
  'members': 'Участники',
  'plans': 'Тариф workspace',
  'provider': 'AI провайдеры',
  'service-model': 'Модели',
  'skill': 'Skills',
  'stats': 'Статистика',
  'storage': 'Хранилище',
  'usage': 'Usage',
};

const MobileWorkspaceSettingsLayout = memo(() => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const workspace = useActiveWorkspace();
  const tab = pathname.split('/settings/')[1]?.split('/')[0] || 'general';

  return (
    <MobileContentLayout
      header={
        <ChatHeader
          showBackButton
          style={mobileHeaderSticky}
          center={
            <ChatHeader.Title
              title={
                <Flexbox align="center" gap={2}>
                  <Text weight={700}>{titleMap[tab] ?? 'Настройки workspace'}</Text>
                  <Text style={{ fontSize: 12 }} type="secondary">
                    {workspace?.name}
                  </Text>
                </Flexbox>
              }
            />
          }
          onBackClick={() => navigate(workspace ? `/${workspace.slug}` : '/', { replace: false })}
        />
      }
    >
      <Flexbox padding={16} style={{ paddingBottom: 96 }}>
        <Outlet />
      </Flexbox>
    </MobileContentLayout>
  );
});

MobileWorkspaceSettingsLayout.displayName = 'MobileWorkspaceSettingsLayout';

export default MobileWorkspaceSettingsLayout;
