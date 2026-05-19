# Suno AI Audio Generation Backend Integration

This document describes the backend infrastructure for Suno AI music generation in ChinnaHub.

## Overview

The audio generation backend provides a complete integration with the Suno AI API (v5.5) for music generation. It includes:

- **Suno API Client** - HTTP client for interacting with Suno's music generation API
- **Database Schema** - Audio generation records storage
- **Polling Service** - Async task polling for generation completion
- **TRPC Router** - Type-safe API endpoints for audio generation operations
- **Database Model** - CRUD operations and queries for audio records

## Architecture

```
User Request
    ↓
TRPC Audio Router (/api/trpc/audio.*)
    ↓
Suno API Client (generateMusic)
    ↓
Suno API: POST https://api.kie.ai/v1/generate
    ↓
Task ID Response
    ↓
Database Model (save to audioGenerations table)
    ↓
Return Task ID to User
    ↓
Polling Service (pollTaskStatus)
    ↓
Suno API: GET https://api.kie.ai/v1/task/{taskId}
    ↓
Update DB with Final Status & Audio URL
```

## Files Created

### 1. Database Schema
**File:** `packages/database/src/schemas/audio.ts`

Defines the `audioGenerations` table with columns for storing music generation records.

### 2. Suno API Client
**File:** `src/business/server/audio-generation/suno.ts`

HTTP client wrapper for Suno API with automatic API key loading and status mapping.

### 3. Polling Service
**File:** `src/server/services/audio/polling.ts`

Manages async polling for task completion with configurable intervals and retry limits.

### 4. Database Model
**File:** `packages/database/src/models/audioGeneration.ts`

ORM model providing CRUD operations and queries for audio records.

### 5. TRPC Router
**File:** `src/server/routers/lambda/audio.ts`

Type-safe API endpoints for audio generation operations.

## Environment Configuration

Add to `.env.chinnahub`:

```bash
# Suno AI API Key
KIE_API_KEY=318e6677c205d1834c7c16a4472e53fb

# Suno API Base URL
SUNO_API_BASE_URL=https://api.kie.ai/v1

# Polling configuration (optional, has defaults)
AUDIO_POLLING_INTERVAL_MS=2000
AUDIO_MAX_RETRIES=20
```

## API Endpoints

### generateAudio (mutation)
Generates music from a text prompt.
- Input: `{ prompt, musicStyle, duration }`
- Output: `{ audioId, taskId, status, createdAt }`

### getAudioStatus (query)
Polls current task status from Suno API.
- Input: `{ taskId }`
- Output: `{ status, audioUrl, progress, metadata, error }`

### getAudioDetails (query)
Retrieves stored audio generation details.
- Input: `{ audioId }`
- Output: full audio record

### deleteAudio (mutation)
Deletes an audio generation record.
- Input: `{ audioId }`
- Output: `{ success: true }`

### listAudioHistory (query)
Lists user's audio generations with pagination.
- Input: `{ page, pageSize }`
- Output: `{ items, pagination }`

## Music Styles

- pop
- rock
- jazz
- lo-fi
- classical
- ambient
- hip-hop

## Testing

Unit tests in `packages/database/src/models/__tests__/audioGeneration.test.ts`

Run: `bun run test packages/database/src/models/__tests__/audioGeneration.test.ts`

## Database Migration

```bash
bun run db:generate  # Generate migration
bun run db:migrate   # Apply migration
```

## Key Features

✅ Type-safe TRPC API integration
✅ Async task polling with configurable intervals
✅ Full CRUD operations for audio records
✅ Automatic Suno API error handling
✅ User-scoped data access
✅ Pagination support
✅ Status tracking (pending → processing → completed/failed)
✅ Audio metadata storage (title, duration, images, lyrics URL)
✅ Input validation for all endpoints

## Documentation

Full integration guide available in `docs/AUDIO_GENERATION.md`
