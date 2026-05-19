# Audio Generation UI Implementation

## Overview

Complete frontend UI for audio generation in ChinnaHub, following the same architectural patterns as image and video generation routes.

## Architecture

### Store Structure (`src/store/audio/`)

The audio store is built with Zustand and follows the same slice-based pattern as image/video:

```
src/store/audio/
├── index.ts                 # Store exports
├── store.ts                 # Main store creation
├── initialState.ts          # Combined initial state
└── slices/
    ├── generationConfig/    # Audio config (style, duration, model)
    │   ├── initialState.ts
    │   ├── action.ts
    │   └── selectors.ts
    ├── generationTopic/     # Generation topics/sessions
    │   ├── initialState.ts
    │   ├── action.ts
    │   └── selectors.ts
    ├── generationBatch/     # Batch generations
    │   ├── initialState.ts
    │   ├── action.ts
    │   └── selectors.ts
    └── createAudio/         # Audio creation state (extensible)
        ├── initialState.ts
        └── action.ts
```

**Key Store States:**
- `musicStyle`: Selected music style (ambient, pop, rock, jazz, lo-fi, classical, hip-hop)
- `duration`: Audio duration in seconds (15-120)
- `modelVersion`: Model version (default: v5.5)
- `generationBatchesMap`: Map of generation batches by topic ID
- `activeGenerationTopicId`: Currently active generation topic

### Route Structure (`src/routes/(main)/(create)/audio/`)

```
src/routes/(main)/(create)/audio/
├── index.tsx                # Main page component
├── _layout/index.tsx        # Layout wrapper
├── loading.tsx              # Loading skeleton
└── features/
    ├── ConfigPanel/         # Config selector panel
    │   └── index.tsx
    ├── PromptInput/         # Prompt textarea
    │   └── index.tsx
    ├── GenerationFeed/      # Generated audio list
    │   ├── index.tsx
    │   └── AudioCard.tsx    # Individual audio card
    └── AudioWorkspace/      # Main workspace layout
        └── index.tsx
```

### Components

#### Audio Player (`src/features/AudioPlayer/`)
- HTML5 audio element with full controls
- Play/pause, volume, progress bar
- Waveform visualizer with canvas
- Download functionality
- Time display (current/duration)

**Features:**
- Real-time frequency visualization
- Volume control
- Progress seeking
- Responsive design

#### Audio Visualizer (`src/features/AudioPlayer/Visualizer.tsx`)
- Canvas-based waveform display
- Uses Web Audio API's AnalyserNode
- Real-time frequency data rendering
- Bars visualize frequency distribution

#### Generation Type Selector
- Dropdown to switch between Image, Video, Audio
- Visual indicators for current generation type
- Navigation to appropriate route

### Hooks

#### `useAudioGeneration`
Handles audio generation API calls.

```typescript
const { generateAudio, loading, error } = useGenerateAudio();
await generateAudio({
  prompt: "upbeat pop song",
  musicStyle: "pop",
  duration: 30,
});
```

#### `useAudioPolling`
Polls task status during generation.

```typescript
const { status, progress, audioUrl, error, isPolling } = useAudioPolling({
  taskId,
  interval: 3000,
  maxRetries: 60,
  onStatusChange: (status) => console.log(status),
  onComplete: (url) => console.log('Ready:', url),
});
```

**Polling Features:**
- Auto-play after 10 seconds
- Progress tracking (0-100%)
- Status updates every 2-5 seconds
- Maximum retry limit
- Auto-stop on completion/failure

### Admin Settings

Component: `src/features/Admin/AdminAudioSettings/index.tsx`

**Configuration Options:**
- Enable/disable audio generation
- API key management (masked input)
- Polling interval adjustment (1000-5000ms)
- Connection testing
- Settings persistence

## Type System

### Updated Types (`packages/types/src/generation/index.ts`)

```typescript
interface AudioGenerationAsset extends BaseGenerationAsset {
  duration?: number;
  originalUrl?: string;
  url?: string;
}

interface AudioGenerationTopic {
  id: string;
  title?: string;
  coverUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface GenerationConfig {
  musicStyle?: string;      // pop|rock|jazz|lo-fi|classical|ambient|hip-hop
  duration?: number;        // 15-120 seconds
  prompt: string;
  // ... other fields
}
```

## Router Integration

### Desktop Router Configuration
- Added to both `desktopRouter.config.tsx` and `desktopRouter.config.desktop.tsx`
- Route path: `/create/audio`
- Sync test validates both configs stay in sync

### Route Handler Pattern
```typescript
{
  path: 'audio',
  element: <AudioLayout />,
  children: [
    { index: true, element: <AudioPage /> }
  ]
}
```

## Styling

Uses `@lobehub/ui` components and `antd-style`:
- Flexbox layouts for responsive design
- Semantic colors for status badges
- Consistent padding and gaps
- Theme integration with LobeHub design

## i18n Support

Already integrated translations:
- `tab.audio`: "Audio"
- Available in both English and Chinese locales

## Integration Points

### TRPC Integration (TODO)
The hooks are ready for TRPC integration:

```typescript
// In useGenerateAudio
const batch = await generationService.generateAudio({
  prompt,
  musicStyle,
  duration,
  topicId: activeTopicId,
});

// In useAudioPolling
const result = await generationService.checkStatus(taskId);
```

### Database Schema
Compatible with existing generation schema:
- `generation_topics` table (type: 'audio')
- `generation_batches` table (stores audio config)
- `generations` table (audio generation records)
- `async_tasks` table (polling status)

## User Flow

1. **Navigation**: User clicks "Audio" tab or uses GenerationTypeSelector
2. **Configuration**: Select music style, duration in ConfigPanel
3. **Prompt**: Enter lyrics/description in PromptInput
4. **Generation**: Click "Generate Audio"
   - Creates new generation batch
   - Starts polling for task status
   - Shows progress in GenerationFeed
5. **Playback**: After 10 seconds, user can click "Play"
   - AudioPlayer renders with visualizer
   - Full playback controls available
   - Download option available

## File Manifest

### Store Files (6 files)
- ✓ `src/store/audio/index.ts`
- ✓ `src/store/audio/store.ts`
- ✓ `src/store/audio/initialState.ts`
- ✓ `src/store/audio/slices/generationConfig/initialState.ts`
- ✓ `src/store/audio/slices/generationConfig/action.ts`
- ✓ `src/store/audio/slices/generationConfig/selectors.ts`
- ✓ `src/store/audio/slices/generationTopic/initialState.ts`
- ✓ `src/store/audio/slices/generationTopic/action.ts`
- ✓ `src/store/audio/slices/generationTopic/selectors.ts`
- ✓ `src/store/audio/slices/generationBatch/initialState.ts`
- ✓ `src/store/audio/slices/generationBatch/action.ts`
- ✓ `src/store/audio/slices/generationBatch/selectors.ts`
- ✓ `src/store/audio/slices/createAudio/initialState.ts`
- ✓ `src/store/audio/slices/createAudio/action.ts`

### Route Files (6 files)
- ✓ `src/routes/(main)/(create)/audio/index.tsx`
- ✓ `src/routes/(main)/(create)/audio/_layout/index.tsx`
- ✓ `src/routes/(main)/(create)/audio/loading.tsx`
- ✓ `src/routes/(main)/(create)/audio/features/ConfigPanel/index.tsx`
- ✓ `src/routes/(main)/(create)/audio/features/PromptInput/index.tsx`
- ✓ `src/routes/(main)/(create)/audio/features/GenerationFeed/index.tsx`
- ✓ `src/routes/(main)/(create)/audio/features/GenerationFeed/AudioCard.tsx`
- ✓ `src/routes/(main)/(create)/audio/features/AudioWorkspace/index.tsx`

### Feature Components (5 files)
- ✓ `src/features/AudioPlayer/index.tsx`
- ✓ `src/features/AudioPlayer/Visualizer.tsx`
- ✓ `src/routes/(main)/(create)/features/GenerationLayout/GenerationTypeSelector.tsx`
- ✓ `src/features/Admin/AdminAudioSettings/index.tsx`

### Hooks (2 files)
- ✓ `src/hooks/useAudioGeneration/index.ts`
- ✓ `src/hooks/useAudioPolling/index.ts`

### Router Updates (2 files modified)
- ✓ `src/spa/router/desktopRouter.config.tsx`
- ✓ `src/spa/router/desktopRouter.config.desktop.tsx`

### Type Updates (1 file modified)
- ✓ `packages/types/src/generation/index.ts`

## Next Steps for Full Implementation

1. **Backend Integration**
   - Implement TRPC procedures for generation
   - Connect to Suno API or similar
   - Implement polling endpoints

2. **Error Handling**
   - Toast notifications for errors
   - Retry logic for failed generations
   - User-friendly error messages

3. **Testing**
   - Unit tests for hooks
   - Component tests for UI
   - Integration tests with store

4. **Performance**
   - Memoization optimization
   - Lazy loading of audio assets
   - Cache management

5. **Accessibility**
   - Audio player controls keyboard support
   - ARIA labels for components
   - Screen reader support

## Notes

- All UI uses @lobehub/ui components for consistency
- Store follows exact same pattern as image/video stores
- Route structure matches existing generation routes
- Audio types added to existing generation type system
- i18n already includes 'tab.audio' translation
- Router sync test will validate audio routes match between both configs

