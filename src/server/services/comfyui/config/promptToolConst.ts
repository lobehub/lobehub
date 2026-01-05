/**
 * Prompt Optimizer Configuration
 * Prompt optimizer configuration - for intelligent splitting and optimization of prompts
 */

/**
 * Style keywords configuration - organized by category
 * Style keyword configuration - organized by category for easy maintenance and extension
 */

/* eslint-disable sort-keys-fix/sort-keys-fix */
export const STYLE_KEYWORDS = {
  // Artists and platforms
  ARTISTS: [
    'by greg rutkowski',
    'by artgerm',
    'by wlop',
    'by alphonse mucha',
    'by james gurney',
    'by makoto shinkai',
    'by ghibli',
    'by hayao miyazaki',
    'by tim burton',
    'by banksy',
    'trending on artstation',
    'artstation',
    'deviantart',
    'pixiv',
    'concept art',
    'illustration',
    'artwork',
    'painting',
    'drawing',
    'digital painting',
  ],

  // Art styles
  ART_STYLES: [
    'photorealistic',
    'photo realistic',
    'realistic',
    'hyperrealistic',
    'hyper realistic',
    'anime',
    'anime style',
    'manga',
    'manga style',
    'cartoon',
    'cartoon style',
    'oil painting',
    'watercolor',
    'watercolor painting',
    'acrylic painting',
    'sketch',
    'pencil sketch',
    'charcoal drawing',
    'digital art',
    '3d render',
    '3d rendering',
    'cgi',
    'pixel art',
    '8bit',
    '16bit',
    'retro pixel',
    'cinematic',
    'film still',
    'movie scene',
    'abstract',
    'abstract art',
    'surreal',
    'surrealism',
    'impressionist',
    'impressionism',
    'expressionist',
    'expressionism',
    'minimalist',
    'minimalism',
    'pop art',
    'art nouveau',
    'art deco',
    'baroque',
    'renaissance',
    'gothic',
    'cyberpunk',
    'steampunk',
    'dieselpunk',
    'solarpunk',
    'vaporwave',
    'synthwave',
    'retrowave',
  ],

  // Lighting effects
  LIGHTING: [
    'dramatic lighting',
    'soft lighting',
    'hard lighting',
    'studio lighting',
    'golden hour',
    'golden hour lighting',
    'blue hour',
    'magic hour',
    'sunset lighting',
    'sunrise lighting',
    'neon lights',
    'neon lighting',
    'rim lighting',
    'backlit',
    'backlighting',
    'volumetric lighting',
    'god rays',
    'crepuscular rays',
    'natural lighting',
    'ambient lighting',
    'warm lighting',
    'cold lighting',
    'cool lighting',
    'moody lighting',
    'atmospheric lighting',
    'cinematic lighting',
    'chiaroscuro',
    'low key lighting',
    'high key lighting',
    'diffused lighting',
    'harsh lighting',
    'candlelight',
    'firelight',
    'moonlight',
    'sunlight',
    'fluorescent',
    'incandescent',
  ],

  // Photography terms
  PHOTOGRAPHY: [
    'depth of field',
    'shallow depth of field',
    'deep depth of field',
    'bokeh',
    'bokeh effect',
    'motion blur',
    'film grain',
    'lens grain',
    'chromatic aberration',
    'lens distortion',
    'fisheye',
    'macro',
    'macro photography',
    'wide angle',
    'ultra wide angle',
    'telephoto',
    'telephoto lens',
    'portrait',
    'portrait photography',
    'landscape',
    'landscape photography',
    'street photography',
    'aerial photography',
    'drone photography',
    'long exposure',
    'time-lapse',
    'close-up',
    'extreme close-up',
    'medium shot',
    'wide shot',
    'establishing shot',
    'dof',
    '35mm',
    '35mm photograph',
    '50mm',
    '85mm',
    'professional photograph',
    'professional photography',
    'dslr',
    'mirrorless',
    'medium format',
    'hasselblad',
    'canon',
    'nikon',
    'sony alpha',
    'film photography',
    'analog photography',
    'polaroid',
    'instant photo',
  ],

  // Quality descriptions
  QUALITY: [
    'high quality',
    'best quality',
    'highest quality',
    'top quality',
    'masterpiece',
    'award winning',
    'professional',
    'professional quality',
    '4k',
    '4k resolution',
    '8k',
    '8k resolution',
    'uhd',
    'ultra hd',
    'full hd',
    'hd',
    'high resolution',
    'high res',
    'ultra detailed',
    'highly detailed',
    'super detailed',
    'extremely detailed',
    'insanely detailed',
    'intricate',
    'intricate details',
    'fine details',
    'sharp',
    'sharp focus',
    'crisp',
    'crystal clear',
    'pristine',
    'flawless',
    'perfect',
    'stunning',
    'beautiful',
    'gorgeous',
    'breathtaking',
    'magnificent',
    'exquisite',
  ],

  // Rendering and effects
  RENDERING: [
    'octane render',
    'octane',
    'unreal engine',
    'unreal engine 5',
    'ue5',
    'unity',
    'blender',
    'maya',
    'cinema 4d',
    'c4d',
    'houdini',
    'zbrush',
    'substance painter',
    'marmoset',
    'keyshot',
    'vray',
    'v-ray',
    'arnold render',
    'redshift',
    'cycles',
    'cycles render',
    'ray tracing',
    'path tracing',
    'global illumination',
    'gi',
    'ambient occlusion',
    'ao',
    'subsurface scattering',
    'sss',
    'pbr',
    'physically based rendering',
    'bloom',
    'bloom effect',
    'lens flare',
    'post processing',
    'color grading',
    'tone mapping',
    'hdr',
    'high dynamic range',
  ],

  // Color and mood
  COLOR_MOOD: [
    'vibrant',
    'vibrant colors',
    'vivid',
    'vivid colors',
    'muted',
    'muted colors',
    'pastel',
    'pastel colors',
    'monochrome',
    'black and white',
    'grayscale',
    'sepia',
    'warm colors',
    'cool colors',
    'cold colors',
    'neon colors',
    'psychedelic',
    'psychedelic colors',
    'rainbow',
    'iridescent',
    'holographic',
    'metallic',
    'chrome',
    'golden',
    'silver',
    'dark',
    'dark mood',
    'moody',
    'atmospheric',
    'ethereal',
    'dreamy',
    'dreamlike',
    'surreal atmosphere',
    'mysterious',
    'mystical',
    'magical',
    'fantasy',
    'epic',
    'dramatic',
    'intense',
    'peaceful',
    'serene',
    'calm',
    'tranquil',
    'melancholic',
    'nostalgic',
    'romantic',
    'whimsical',
    'playful',
    'cheerful',
    'gloomy',
    'ominous',
    'eerie',
    'creepy',
    'horror',
    'gothic atmosphere',
  ],

  // Texture and materials
  TEXTURE_MATERIAL: [
    'glossy',
    'matte',
    'satin',
    'rough',
    'smooth',
    'polished',
    'brushed',
    'textured',
    'glass',
    'crystal',
    'transparent',
    'translucent',
    'reflective',
    'refractive',
    'metallic texture',
    'chrome finish',
    'copper',
    'brass',
    'bronze',
    'steel',
    'aluminum',
    'titanium',
    'wood',
    'wooden',
    'oak',
    'mahogany',
    'bamboo',
    'marble',
    'granite',
    'stone',
    'concrete',
    'brick',
    'fabric',
    'cloth',
    'silk',
    'velvet',
    'cotton',
    'denim',
    'leather',
    'suede',
    'fur',
    'plastic',
    'rubber',
    'latex',
    'organic',
    'bio',
    'liquid',
    'fluid',
    'gel',
    'ice',
    'frost',
    'frozen',
    'wet',
    'dry',
    'dusty',
    'rusty',
    'weathered',
    'aged',
    'vintage texture',
    'retro texture',
  ],
} as const;

/**
 * Style synonyms mapping for better recognition
 * Synonym mapping to improve recognition accuracy
 */
export const STYLE_SYNONYMS: Record<string, string[]> = {
  // Photography variations
  'photorealistic': [
    'photo-realistic',
    'photo realistic',
    'lifelike',
    'true-to-life',
    'true to life',
  ],
  'hyperrealistic': ['hyper-realistic', 'hyper realistic', 'ultra realistic', 'ultrarealistic'],
  'depth of field': ['dof', 'depth-of-field', 'focal depth', 'focus depth'],
  'bokeh': ['bokeh effect', 'background blur', 'out of focus background'],

  // Art style variations
  'cinematic': ['filmic', 'movie-like', 'film-style', 'theatrical', 'cinema style'],
  'anime': ['anime-style', 'japanese animation', 'animestyle'],
  'manga': ['manga-style', 'japanese comic', 'mangastyle'],
  '3d render': ['3d-render', '3d rendering', '3d-rendering', 'three dimensional', 'cgi render'],
  'digital art': ['digital-art', 'digital artwork', 'digital painting', 'digitalart'],

  // Quality variations
  '4k': ['4k resolution', '4k quality', 'ultra hd', 'uhd', '3840x2160', '4096x2160'],
  '8k': ['8k resolution', '8k quality', 'ultra hd+', '7680x4320', '8192x4320'],
  'high quality': ['high-quality', 'hq', 'hi quality', 'hi-quality', 'highquality'],
  'masterpiece': ['master piece', 'master-piece', 'opus', 'magnum opus'],

  // Lighting variations
  'golden hour': ['golden-hour', 'magic hour', 'sunset light', 'sunrise light'],
  'rim lighting': ['rim-lighting', 'rimlight', 'rim light', 'edge lighting'],
  'volumetric lighting': ['volumetric-lighting', 'god rays', 'light rays', 'sun rays'],

  // Rendering variations
  'octane render': ['octane-render', 'octanerender', 'otoy octane'],
  'unreal engine': ['unreal-engine', 'ue4', 'ue5', 'unrealengine'],
  'ray tracing': ['ray-tracing', 'raytracing', 'rt', 'rtx'],

  // Artist variations
  'by greg rutkowski': ['greg rutkowski', 'rutkowski', 'greg-rutkowski'],
  'by artgerm': ['artgerm', 'stanley lau', 'artgerm lau'],
  'trending on artstation': ['artstation trending', 'artstation hq', 'artstation-hq'],
};

/**
 * Compound styles that should be recognized as a whole
 * Compound styles that should be recognized as a complete unit
 */
export const COMPOUND_STYLES = [
  // Studio and brand styles
  'studio ghibli style',
  'pixar style',
  'disney style',
  'dreamworks style',
  'marvel style',
  'dc comics style',

  // Specific art movements
  'art nouveau style',
  'art deco style',
  'pop art style',
  'street art style',
  'graffiti style',

  // Game and media styles
  'league of legends style',
  'overwatch style',
  'world of warcraft style',
  'final fantasy style',
  'zelda style',
  'pokemon style',

  // Photography styles
  'national geographic style',
  'vogue style',
  'fashion photography',
  'portrait photography',
  'landscape photography',
  'street photography',
  'wildlife photography',
  'macro photography',

  // Specific artist styles
  'van gogh style',
  'picasso style',
  'monet style',
  'rembrandt style',
  'da vinci style',
  'warhol style',
  'banksy style',
  'tim burton style',
  'wes anderson style',
  'christopher nolan style',

  // Technical compound terms
  'physically based rendering',
  'global illumination',
  'subsurface scattering',
  'ambient occlusion',
  'chromatic aberration',
  'depth of field',
  'motion blur',
  'lens flare',

  // Atmosphere combinations
  'cinematic lighting',
  'dramatic lighting',
  'studio lighting',
  'natural lighting',
  'volumetric fog',
  'atmospheric perspective',
  'aerial perspective',

  // Quality combinations
  'ultra high definition',
  'ultra high quality',
  'super high resolution',
  'professional quality',
  'production quality',
  'broadcast quality',
  'print quality',

  // Complex styles
  'cyberpunk aesthetic',
  'steampunk aesthetic',
  'vaporwave aesthetic',
  'synthwave aesthetic',
  'cottagecore aesthetic',
  'dark academia aesthetic',
  'y2k aesthetic',
  'minimalist design',
  'maximalist design',
  'brutalist architecture',
  'gothic architecture',
  'baroque architecture',
] as const;

/**
 * Precise adjective patterns for style extraction
 * Precise adjective patterns for style extraction
 */
export const STYLE_ADJECTIVE_PATTERNS = {
  // Visual quality related
  quality:
    /^(sharp|blur(ry)?|clear|crisp|clean|smooth|rough|grainy|noisy|pristine|flawless|perfect|polished)$/i,

  // Artistic style related
  artistic:
    /^(abstract|surreal|minimal(ist)?|ornate|baroque|gothic|modern|contemporary|traditional|classical|vintage|retro|antique|futuristic|avant-garde)$/i,

  // Color and lighting
  visual:
    /^(bright|dark|dim|vibrant|vivid|muted|saturated|desaturated|warm|cool|cold|hot|soft|hard|harsh|gentle|subtle|bold|pale|rich|deep)$/i,

  // Mood and atmosphere
  mood: /^(dramatic|peaceful|chaotic|serene|calm|mysterious|mystical|magical|epic|legendary|heroic|romantic|melancholic|nostalgic|whimsical|playful|serious|solemn|cheerful|gloomy|ominous|eerie|creepy|scary|dreamy|ethereal|fantastical|moody|atmospheric)$/i,

  // Texture and material
  texture:
    /^(metallic|wooden|glass(y)?|crystalline|fabric|leather|plastic|rubber|organic|synthetic|liquid|solid|transparent|translucent|opaque|reflective|matte|glossy|satin|rough|smooth|wet|dry|dusty|rusty|weathered|aged|new|fresh|worn)$/i,

  // Size and scale
  scale:
    /^(tiny|small|medium|large|huge|massive|gigantic|colossal|enormous|microscopic|miniature|oversized|epic-scale|human-scale|intimate|vast|infinite)$/i,

  // Complexity and detail
  detail:
    /^(simple|complex|intricate|elaborate|detailed|minimal|advanced|sophisticated|primitive|refined|crude|delicate|robust)$/i,

  // Professional quality
  professional:
    /^(professional|amateur|masterful|skilled|expert|novice|polished|raw|finished|unfinished|complete|incomplete|refined|rough)$/i,
} as const;

/* eslint-enable sort-keys-fix/sort-keys-fix */

/**
 * Get all style keywords as a flattened array
 * Get all style keywords as a flattened array
 */
export function getAllStyleKeywords(): readonly string[] {
  return Object.values(STYLE_KEYWORDS).flat();
}

/**
 * Get all compound styles
 * Get all compound styles
 */
export function getCompoundStyles(): readonly string[] {
  return COMPOUND_STYLES;
}

/**
 * Normalize a style term using synonyms
 * Normalize a style term using synonyms
 */
export function normalizeStyleTerm(term: string): string {
  const lowerTerm = term.toLowerCase();

  // Check if this term is a synonym
  for (const [canonical, synonyms] of Object.entries(STYLE_SYNONYMS)) {
    if (synonyms.includes(lowerTerm)) {
      return canonical;
    }
  }

  return term;
}

/**
 * Check if a word matches any style adjective pattern
 * Check if a word matches any style adjective pattern
 */
export function isStyleAdjective(word: string): boolean {
  const lowerWord = word.toLowerCase();
  return Object.values(STYLE_ADJECTIVE_PATTERNS).some((pattern) => pattern.test(lowerWord));
}

/**
 * Extract style adjectives from words based on precise patterns
 * Extract style adjectives from words based on precise patterns
 */
export function extractStyleAdjectives(words: string[]): string[] {
  return words.filter((word) => isStyleAdjective(word));
}
