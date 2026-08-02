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
const AicoManagedRedirect = dynamic(() => import('./AicoManagedRedirect'), {
  loading: () => <Loading debugId="Provider > AicoRedirect" />,
  ssr: false,
});

type ProviderDetailPageProps = {
  id?: string | null;
  onProviderSelect: (provider: string) => void;
};

const ProviderDetailPage = (props: ProviderDetailPageProps) => {
  const { id, onProviderSelect } = props;

  let content;
  switch (id) {
    case 'all':
    case undefined:
    case null: {
      content = <ProviderGrid onProviderSelect={onProviderSelect} />;
      break;
    }
    case 'aico':
    case 'openrouter': {
      content = <DefaultPage id="openrouter" />;
      break;
    }
    case 'azure': {
      content = <Azure />;
      break;
    }
    case 'azureai': {
      content = <AzureAI />;
      break;
    }
    case 'bedrock': {
      content = <Bedrock />;
      break;
    }
    case 'cloudflare': {
      content = <Cloudflare />;
      break;
    }
    case 'comfyui': {
      content = <ComfyUI />;
      break;
    }
    case 'github': {
      content = <GitHub />;
      break;
    }
    case 'ollama': {
      content = <Ollama />;
      break;
    }
    case 'newapi': {
      content = <NewAPI />;
      break;
    }
    case 'openai': {
      content = <OpenAI />;
      break;
    }
    case 'vertexai': {
      content = <VertexAI />;
      break;
    }
    default: {
      content = <DefaultPage id={id} />;
      break;
    }
  }

  return (
    <AicoManagedRedirect fallback={content} id={id}>
      {content}
    </AicoManagedRedirect>
  );
};

export default ProviderDetailPage;
