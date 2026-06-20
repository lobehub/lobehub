'use client';

import { Button, Center, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2, Clock3, ShieldAlert, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { mutate } from 'swr';

import { WORKSPACE_LIST_KEY } from '@/business/client/hooks/useWorkspaces';
import { setActiveWorkspaceSnapshot } from '@/business/client/hooks/workspaceState';
import { lambdaClient } from '@/libs/trpc/client';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    width: min(560px, calc(100vw - 32px));
    padding: 28px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 28px;

    background:
      radial-gradient(circle at 100% 0, ${cssVar.colorPrimaryBg} 0, transparent 40%),
      ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  icon: css`
    display: grid;
    place-items: center;

    width: 56px;
    height: 56px;
    border-radius: 18px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  muted: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

type State =
  | { status: 'ready' }
  | { status: 'accepting' }
  | { message: string; status: 'error' }
  | { slug: string; status: 'accepted'; workspaceName: string };

const InvitePage = () => {
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ status: 'ready' });

  const accept = async () => {
    if (!token) {
      setState({ message: 'Ссылка приглашения неполная или повреждена.', status: 'error' });
      return;
    }

    setState({ status: 'accepting' });
    try {
      const accepted = await lambdaClient.workspaceMember.acceptInvitation.mutate({ token });
      const workspace = accepted.workspace;
      if (!workspace) throw new Error('Workspace приглашения не найден.');

      setActiveWorkspaceSnapshot({ id: accepted.workspaceId, slug: workspace.slug });
      await mutate(WORKSPACE_LIST_KEY);

      setState({
        slug: workspace.slug,
        status: 'accepted',
        workspaceName: workspace.name || workspace.slug,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось принять приглашение.';
      setState({ message, status: 'error' });
    }
  };

  return (
    <Center height="100%" padding={16} width="100%">
      <Flexbox className={styles.card} gap={22}>
        <Flexbox horizontal align="center" gap={14}>
          <div className={styles.icon}>
            {state.status === 'accepted' ? <CheckCircle2 size={28} /> : <UsersRound size={28} />}
          </div>
          <Flexbox gap={4}>
            <Flexbox horizontal gap={8}>
              <Tag color={state.status === 'error' ? 'red' : 'blue'}>Workspace invite</Tag>
              {state.status === 'accepting' && <Tag icon={<Clock3 size={12} />}>Проверяем</Tag>}
            </Flexbox>
            <Text as="h1" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1, margin: 0 }}>
              {state.status === 'accepted'
                ? 'Приглашение принято'
                : state.status === 'error'
                  ? 'Не удалось принять приглашение'
                  : state.status === 'accepting'
                    ? 'Принимаем приглашение'
                    : 'Вас пригласили в workspace'}
            </Text>
          </Flexbox>
        </Flexbox>

        {state.status === 'ready' && (
          <Flexbox gap={14}>
            <Text className={styles.muted}>
              Нажмите кнопку, чтобы принять приглашение и добавить этот аккаунт в workspace.
            </Text>
            <Button block type="primary" onClick={accept}>
              Принять приглашение
            </Button>
          </Flexbox>
        )}

        {state.status === 'accepting' && (
          <Flexbox gap={14}>
            <Text className={styles.muted}>Подключаем вас к workspace.</Text>
            <Button block disabled loading type="primary">
              Принимаем
            </Button>
          </Flexbox>
        )}

        {state.status === 'accepted' && (
          <Flexbox gap={14}>
            <Text className={styles.muted}>
              Вы добавлены в «{state.workspaceName}». Теперь доступны общие агенты, знания,
              провайдеры и командные лимиты.
            </Text>
            <Button
              block
              type="primary"
              onClick={() => navigate(`/${state.slug}`, { replace: true })}
            >
              Перейти в workspace
            </Button>
          </Flexbox>
        )}

        {state.status === 'error' && (
          <Flexbox gap={14}>
            <Flexbox horizontal align="center" gap={10}>
              <ShieldAlert size={18} />
              <Text>{state.message}</Text>
            </Flexbox>
            <Text className={styles.muted}>
              Ссылка могла истечь, быть отозвана владельцем или уже использована. Попросите
              владельца workspace отправить новое приглашение.
            </Text>
            <Flexbox horizontal gap={8}>
              <Button type="primary" onClick={() => navigate('/', { replace: true })}>
                На главную
              </Button>
              <Button onClick={() => globalThis.location.reload()}>Повторить</Button>
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    </Center>
  );
};

export default InvitePage;
