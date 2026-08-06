import Loading from '@/components/Loading/BrandTextLoading';
import dynamic from '@/libs/next/dynamic';

const NewAPI = dynamic(() => import('./newapi'), {
  loading: () => <Loading debugId="Provider > NewAPI" />,
  ssr: false,
});
const OpenAI = dynamic(() => import('./openai'), {
  loading: () => <Loading debugId="Provider > OpenAI" />,
  ssr: false,
});
const VertexAI = dynamic(() => import('./vertexai'), {
  loading: () => <Loading debugId="Provider > VertexAI" />,
  ssr: false,
});
const GitHub = dynamic(() => import('./github'), {
  loading: () => <Loading debugId="Provider > GitHub" />,
  ssr: false,
});
const Ollama = dynamic(() => import('./ollama'), {
  loading: () => <Loading debugId="Provider > Ollama" />,
  ssr: false,
});
const ComfyUI = dynamic(() => import('./comfyui'), {
  loading: () => <Loading debugId="Provider > ComfyUI" />,
  ssr: false,
});
const Cloudflare = dynamic(() => import('./cloudflare'), {
  loading: () => <Loading debugId="Provider > Cloudflare" />,
  ssr: false,
});
const Bedrock = dynamic(() => import('./bedrock'), {
  loading: () => <Loading debugId="Provider > Bedrock" />,
  ssr: false,
});
const AzureAI = dynamic(() => import('./azureai'), {
  loading: () => <Loading debugId="Provider > AzureAI" />,
  ssr: false,
});
const Azure = dynamic(() => import('./azure'), {
  loading: () => <Loading debugId="Provider > Azure" />,
  ssr: false,
});
const ProviderGrid = dynamic(() => import('../(list)/ProviderGrid'), {
  loading: () => <Loading debugId="Provider > Grid" />,
  ssr: false,
});
const DefaultPage = dynamic(() => import('./default/ProviderDetialPage'), {
  loading: () => <Loading debugId="Provider > Default" />,
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
