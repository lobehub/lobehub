import ProviderGrid from '../(list)/ProviderGrid';
import Azure from './azure';
import AzureAI from './azureai';
import Bedrock from './bedrock';
import Cloudflare from './cloudflare';
import ComfyUI from './comfyui';
import DefaultPage from './default/ProviderDetialPage';
import GitHub from './github';
import Ollama from './ollama';
import OpenAI from './openai';
import VertexAI from './vertexai';

const ProviderDetailPage = (props: { id?: string | null }) => {
  const { id } = props;

  switch (id) {
    case 'all': {
      return <ProviderGrid />;
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
