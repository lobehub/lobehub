'use client';

import { Center, Empty, Flexbox, Text, Typography } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Image } from '@lobehub/ui/mdx';
import { createStaticStyles } from 'antd-style';
import { FileClockIcon } from 'lucide-react';
import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { type Components } from 'react-markdown';
import { useParams } from 'react-router';
import urlJoin from 'url-join';

import VersionTag from '@/components/ChangelogModal/VersionTag';
import { CustomMDX } from '@/components/mdx';
import CollapsibleSection from '@/components/mdx/CollapsibleSection';
import remarkCollapsibleSections from '@/components/mdx/remarkCollapsibleSections';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { CHANGELOG_PATH } from '@/const/url';
import { useAicoPanelContainerProps } from '@/features/AicoPanels';
import SettingContainer from '@/features/Setting/SettingContainer';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { useChangelogIndex } from './useChangelogIndex';
import { useChangelogPost } from './useChangelogPost';

const styles = createStaticStyles(({ css, cssVar }) => ({
  back: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimary};
      text-decoration: underline;
    }
  `,
  title: css`
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.3;
  `,
}));

const ChangelogPostPage = memo(() => {
  const { t } = useTranslation(['changelog', 'common']);
  const { id } = useParams<{ id: string }>();
  const containerProps = useAicoPanelContainerProps(800);
  const { data, error, isLoading, retry } = useChangelogPost(id);
  const { data: index } = useChangelogIndex();
  const versionRange = index?.find((item) => item.id === id)?.versionRange;

  return (
    <SettingContainer {...containerProps}>
      <Flexbox gap={24} padding={16} width={'100%'}>
        <WorkspaceLink escape className={styles.back} to={CHANGELOG_PATH}>
          {t('backToList')}
        </WorkspaceLink>

        {isLoading ? (
          <Center style={{ minHeight: '40vh' }}>
            <NeuralNetworkLoading />
          </Center>
        ) : error || !data || !data.title ? (
          <Center style={{ minHeight: '40vh' }}>
            <Flexbox align={'center'} gap={16}>
              <Empty description={error ? t('loadError') : t('notFound')} icon={FileClockIcon} />
              {error ? (
                <Button onClick={() => retry()}>{t('retry', { ns: 'common' })}</Button>
              ) : null}
            </Flexbox>
          </Center>
        ) : (
          <Typography headerMultiple={0.2}>
            <h1 className={styles.title}>{data.rawTitle || data.title}</h1>
            {data.date ? (
              <Text type={'secondary'}>{new Date(data.date).toLocaleDateString()}</Text>
            ) : null}
            {data.image && (
              <Image
                alt={data.title}
                src={
                  data.image.startsWith('/blog')
                    ? urlJoin('https://hub-apac-1.lobeobjects.space/', data.image)
                    : data.image
                }
              />
            )}
            <Suspense fallback={<NeuralNetworkLoading />}>
              <CustomMDX
                components={{ 'collapsible-section': CollapsibleSection } as Components}
                remarkPlugins={[remarkCollapsibleSections]}
                source={data.content}
              />
            </Suspense>
            {versionRange ? <VersionTag range={versionRange} /> : null}
          </Typography>
        )}
      </Flexbox>
    </SettingContainer>
  );
});

ChangelogPostPage.displayName = 'ChangelogPostPage';

export default ChangelogPostPage;
