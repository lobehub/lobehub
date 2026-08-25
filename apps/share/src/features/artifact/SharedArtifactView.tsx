'use client';

import { Center } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useParams } from 'react-router';
import useSWR from 'swr';

import Loading from '@/components/Loading/BrandTextLoading';
import ShareErrorView from '@/features/Share/ErrorView';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import { ArtifactShareChrome } from './ArtifactShareChrome';

const styles = createStaticStyles(({ css, cssVar }) => ({
  frame: css`
    width: 100%;
    height: 100%;
    border: 0;
    background: ${cssVar.colorBgLayout};
  `,
  root: css`
    display: flex;
    flex-direction: column;

    width: 100%;
    height: 100dvh;

    background: ${cssVar.colorBgLayout};
  `,
  stage: css`
    overflow: hidden;
    flex: 1;
  `,
}));

const SharedArtifactView = () => {
  const { id } = useParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(
    id ? shareKeys.artifact(id) : null,
    () => lambdaClient.artifactShare.getShared.query({ id: id! }),
    { revalidateOnFocus: false },
  );

  if (!error && !data && isLoading) {
    return (
      <Center height={'100dvh'}>
        <Loading debugId="SharedArtifactView" />
      </Center>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.root}>
        <ArtifactShareChrome />
        <div className={styles.stage}>
          <ShareErrorView error={error} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <ArtifactShareChrome title={data.title} />
      <div className={styles.stage}>
        <iframe
          className={styles.frame}
          referrerPolicy={'no-referrer'}
          sandbox={'allow-scripts'}
          src={data.iframeSrc}
          title={data.title ?? 'Artifact'}
        />
      </div>
    </div>
  );
};

export default SharedArtifactView;
