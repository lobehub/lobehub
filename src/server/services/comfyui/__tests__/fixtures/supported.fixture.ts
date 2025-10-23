// 可扩展的支持配置接口
export interface SupportedConfig {
  extensions?: Record<string, any>;
  models: Record<string, string[]>;
  workflows: string[];
}

// 基础支持配置
const baseConfig: SupportedConfig = {
  extensions: {},
  models: {
    flux: ['flux-dev', 'flux-schnell', 'flux-kontext', 'flux-krea'],
    sd: ['sd15', 'sdxl', 'sd35'],
  },
  workflows: ['flux-dev', 'flux-schnell', 'flux-kontext', 'flux-krea', 'simple-sd', 'sd35'],
};

// 动态配置合并函数
function mergeConfig(base: SupportedConfig, custom?: Partial<SupportedConfig>): SupportedConfig {
  if (!custom) return base;

  return {
    // 去重
extensions: {
      ...base.extensions,
      ...custom.extensions,
    },
    
models: {
      ...base.models,
      ...custom.models,
    }, 
    workflows: [...base.workflows, ...(custom.workflows || [])].filter(
      (workflow, index, array) => array.indexOf(workflow) === index,
    ),
  };
}

// 可扩展的 fixture 对象
export const supportedFixture = {
  
  // 扩展工具函数
addCustomModels: (modelType: string, models: string[]) => {
    baseConfig.models[modelType] = [...(baseConfig.models[modelType] || []), ...models].filter(
      (model, index, array) => array.indexOf(model) === index,
    );
  },

  
  

addCustomWorkflows: (workflows: string[]) => {
    baseConfig.workflows = [...baseConfig.workflows, ...workflows].filter(
      (workflow, index, array) => array.indexOf(workflow) === index,
    );
  },

  
  

// 获取当前配置（支持自定义扩展）
getConfig: (customConfig?: Partial<SupportedConfig>): SupportedConfig => {
    return mergeConfig(baseConfig, customConfig);
  },
  

// 验证帮助函数
isSupported: (model: string, customConfig?: Partial<SupportedConfig>) => {
    const config = mergeConfig(baseConfig, customConfig);
    const allModels = Object.values(config.models).flat();
    return allModels.includes(model);
  },

  
  // 向后兼容的属性（保持现有测试不受影响）
models: baseConfig.models,

  // 重置为基础配置（用于测试隔离）
reset: () => {
    baseConfig.models = {
      flux: ['flux-dev', 'flux-schnell', 'flux-kontext', 'flux-krea'],
      sd: ['sd15', 'sdxl', 'sd35'],
    };
    baseConfig.workflows = [
      'flux-dev',
      'flux-schnell',
      'flux-kontext',
      'flux-krea',
      'simple-sd',
      'sd35',
    ];
    baseConfig.extensions = {};
  },

  
  workflows: baseConfig.workflows,
};
