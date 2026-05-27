export const getLanguageFromFilename = (fileName?: string | null): string => {
  if (!fileName) return 'txt';

  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs': {
      return 'javascript';
    }
    case 'ts': {
      return 'typescript';
    }
    case 'tsx': {
      return 'tsx';
    }
    case 'jsx': {
      return 'jsx';
    }

    case 'py':
    case 'pyw': {
      return 'python';
    }

    case 'java': {
      return 'java';
    }
    case 'kt':
    case 'kts': {
      return 'kotlin';
    }
    case 'scala': {
      return 'scala';
    }
    case 'groovy': {
      return 'groovy';
    }

    case 'c':
    case 'h': {
      return 'c';
    }
    case 'cpp':
    case 'cxx':
    case 'cc':
    case 'hpp':
    case 'hxx': {
      return 'cpp';
    }

    case 'cs': {
      return 'csharp';
    }

    case 'go': {
      return 'go';
    }

    case 'rs': {
      return 'rust';
    }

    case 'rb': {
      return 'ruby';
    }

    case 'php': {
      return 'php';
    }

    case 'swift': {
      return 'swift';
    }

    case 'sh':
    case 'bash':
    case 'zsh': {
      return 'bash';
    }

    case 'html':
    case 'htm': {
      return 'html';
    }
    case 'css': {
      return 'css';
    }
    case 'scss': {
      return 'scss';
    }
    case 'sass': {
      return 'sass';
    }
    case 'less': {
      return 'less';
    }

    case 'json': {
      return 'json';
    }
    case 'xml': {
      return 'xml';
    }
    case 'yaml':
    case 'yml': {
      return 'yaml';
    }
    case 'toml': {
      return 'toml';
    }

    case 'md':
    case 'mdx': {
      return 'markdown';
    }

    case 'sql': {
      return 'sql';
    }

    case 'lua': {
      return 'lua';
    }
    case 'r': {
      return 'r';
    }
    case 'dart': {
      return 'dart';
    }
    case 'elixir':
    case 'ex':
    case 'exs': {
      return 'elixir';
    }
    case 'erl':
    case 'hrl': {
      return 'erlang';
    }
    case 'clj':
    case 'cljs':
    case 'cljc': {
      return 'clojure';
    }
    case 'vim': {
      return 'vim';
    }
    case 'dockerfile': {
      return 'dockerfile';
    }
    case 'graphql':
    case 'gql': {
      return 'graphql';
    }

    default: {
      return 'txt';
    }
  }
};
