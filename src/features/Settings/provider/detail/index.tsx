import SurfaceSkeleton from '@/components/Skeleton/Surface';
import dynamic from '@/libs/next/dynamic';

const NewAPI = dynamic(() => import('./newapi'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const OpenAI = dynamic(() => import('./openai'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const VertexAI = dynamic(() => import('./vertexai'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const GitHub = dynamic(() => import('./github'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const Ollama = dynamic(() => import('./ollama'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const ComfyUI = dynamic(() => import('./comfyui'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const Cloudflare = dynamic(() => import('./cloudflare'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const Bedrock = dynamic(() => import('./bedrock'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const AzureAI = dynamic(() => import('./azureai'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const Azure = dynamic(() => import('./azure'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});
const ProviderGrid = dynamic(() => import('../(list)/ProviderGrid'), {
  loading: () => <SurfaceSkeleton header={false} variant={'grid'} />,
  ssr: false,
});
const DefaultPage = dynamic(() => import('./default/ProviderDetialPage'), {
  loading: () => <SurfaceSkeleton header={false} variant={'form'} />,
  ssr: false,
});

type ProviderDetailPageProps = {
  id?: string | null;
  onProviderSelect: (provider: string) => void;
};

const ProviderDetailPage = (props: ProviderDetailPageProps) => {
  const { id, onProviderSelect } = props;

  switch (id) {
    case 'all': {
      return <ProviderGrid onProviderSelect={onProviderSelect} />;
    }
    case 'azure': {
      return <Azure />;
    }
    case 'azureai': {
      return <AzureAI />;
    }
    case 'bedrock': {
      return <Bedrock />;
    }
    case 'cloudflare': {
      return <Cloudflare />;
    }
    case 'comfyui': {
      return <ComfyUI />;
    }
    case 'github': {
      return <GitHub />;
    }
    case 'ollama': {
      return <Ollama />;
    }
    case 'newapi': {
      return <NewAPI />;
    }
    case 'openai': {
      return <OpenAI />;
    }
    case 'vertexai': {
      return <VertexAI />;
    }
    default: {
      return <DefaultPage id={id} />;
    }
  }
};

export default ProviderDetailPage;
