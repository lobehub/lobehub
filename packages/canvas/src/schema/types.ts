export type CanvasAttributeType = 'boolean' | 'enum' | 'json' | 'number' | 'string';

export interface CanvasAttributeSpec {
  description: string;
  required?: boolean;
  type: CanvasAttributeType;
  values?: readonly string[];
}

export type CanvasComponentCategory = 'chart' | 'control' | 'data' | 'layout' | 'text';

export type CanvasChildren = 'content' | 'none' | 'options' | 'text';

export interface CanvasComponentSpec {
  attributes: Record<string, CanvasAttributeSpec>;
  category: CanvasComponentCategory;
  children: CanvasChildren;
  description: string;
  example: string;
  parents?: readonly string[];
  tag: string;
}
