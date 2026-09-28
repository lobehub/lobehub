'use client';

import { createStaticStyles } from 'antd-style';
import { useParams } from 'react-router';
import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import ShareLayout from '../../shell/ShareLayout';

const styles = createStaticStyles(({ css, cssVar }) => ({
  frame: css`
    width: 100%;
    height: 100%;
    border: 0;
    background: ${cssVar.colorBgLayout};
  `,
}));

const SharedArtifactView = () => {
  const { id } = useParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(
    id ? shareKeys.artifact(id) : null,
    () => lambdaClient.artifactShare.getShared.query({ id: id! }),
    { revalidateOnFocus: false },
  );

  const loading = isLoading && !data;

  return (
    <ShareLayout error={error || (!loading && !data)} loading={loading} title={data?.title}>
      {data && (
        <iframe
          className={styles.frame}
          referrerPolicy={'no-referrer'}
          sandbox={'allow-scripts'}
          src={data.iframeSrc}
          title={data.title ?? 'Artifact'}
        />
      )}
    </ShareLayout>
  );
};

export default SharedArtifactView;
