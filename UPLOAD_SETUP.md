# ChinnaHub File Upload Configuration Guide

## Overview

ChinnaHub supports uploading external files, images, videos, and audio files to a compatible S3 storage provider. This guide covers the configuration and troubleshooting.

## Supported File Types & Size Limits

### Images
- **Formats**: JPEG, PNG, GIF, WebP, SVG
- **Maximum Size**: 50 MB
- **MIME Types**: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`

### Videos
- **Formats**: MP4, WebM, QuickTime (.mov), AVI
- **Maximum Size**: 500 MB
- **MIME Types**: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`

### Audio
- **Formats**: MP3, WAV, OGG, M4A, WebM
- **Maximum Size**: 100 MB
- **MIME Types**: `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/m4a`, `audio/webm`

### Documents
- **Formats**: PDF, TXT, CSV, Excel, Word, PowerPoint
- **Maximum Size**: 100 MB
- **MIME Types**: `application/pdf`, `text/plain`, `text/csv`, `application/vnd.ms-excel`, etc.

## Environment Configuration

### AWS S3

```env
# Required for S3 file uploads
S3_ACCESS_KEY_ID=your_access_key_here
S3_SECRET_ACCESS_KEY=your_secret_key_here
S3_BUCKET=chinnahub-uploads
S3_REGION=us-east-1
S3_ENDPOINT=https://s3.amazonaws.com
S3_SET_ACL=0

# Public domain for file access (set to your bucket's public URL or CDN)
S3_PUBLIC_DOMAIN=https://chinnahub-uploads.s3.amazonaws.com
```

### MinIO (Local Development)

```env
# For local MinIO development
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=chinnahub
S3_REGION=us-east-1
S3_ENDPOINT=http://localhost:9000
S3_ENABLE_PATH_STYLE=1
S3_SET_ACL=0

NEXT_PUBLIC_S3_DOMAIN=http://localhost:9000/chinnahub
```

### Cloudflare R2

```env
# For Cloudflare R2 with public access
S3_ACCESS_KEY_ID=your_r2_access_key
S3_SECRET_ACCESS_KEY=your_r2_secret_key
S3_BUCKET=chinnahub
S3_REGION=auto
S3_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
S3_SET_ACL=0

# Public domain (R2 with public bucket)
S3_PUBLIC_DOMAIN=https://pub-xxx.r2.dev
```

## S3 Configuration Requirements

### AWS S3 CORS Configuration

Edit the CORS configuration for your S3 bucket:

```json
[
  {
    "AllowedHeaders": [
      "Authorization",
      "Content-Type",
      "x-amz-*"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD",
      "PUT",
      "POST",
      "DELETE"
    ],
    "AllowedOrigins": [
      "https://your-chinnahub-domain.com",
      "http://localhost:3010"
    ],
    "ExposeHeaders": [
      "x-amz-version-id"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

### MinIO CORS Configuration

```bash
# Set CORS policy for MinIO bucket
mc admin config set minio/ api cors_allow_origin="*"
mc ls minio/chinnahub --recursive --stat
```

### Cloudflare R2 Configuration

1. Create a public R2 bucket
2. Enable public access for the bucket
3. Configure CORS in the bucket settings if needed

## Troubleshooting

### Test S3 Connection

Use the diagnostic endpoint to verify S3 configuration:

```bash
# Check S3 connectivity (no auth required)
curl http://localhost:3010/api/trpc/upload.testS3Connection
```

Response should look like:
```json
{
  "result": {
    "data": {
      "checks": {
        "hasAccessKey": true,
        "hasBucket": true,
        "hasEndpoint": true,
        "hasSecretKey": true,
        "isConfigComplete": true
      },
      "success": true,
      "testUrl": "Generated successfully"
    }
  }
}
```

### Common Issues

#### 1. "S3 environment variables are not set completely"
- **Cause**: Missing required environment variables
- **Solution**: Ensure all 4 variables are set: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_ENDPOINT`
- **Check**: `npm run dev` and look for initialization errors

#### 2. "File size exceeds limit"
- **Cause**: File is larger than allowed maximum for its type
- **Solution**: Compress or split the file
- **Limits**: Images (50MB), Videos (500MB), Audio (100MB), Documents (100MB)

#### 3. "Unsupported file type"
- **Cause**: Trying to upload a file type that's not in the allowed list
- **Solution**: Convert file to a supported format
- **Supported**: Images, videos, audio, PDFs, office documents, text/CSV

#### 4. "Network error during upload"
- **Cause**: Connection lost or timeout during upload
- **Solution**: Check network connection and try again
- **Note**: Large files may timeout if upload takes > 10 minutes

#### 5. "Upload failed with status 403"
- **Cause**: Access denied by S3 (credentials or permissions)
- **Solution**: 
  - Verify credentials are correct
  - Check IAM policy allows PutObject on bucket
  - Verify bucket is not private

#### 6. "Upload failed with status 404"
- **Cause**: S3 endpoint or bucket doesn't exist
- **Solution**: 
  - Verify `S3_ENDPOINT` is correct and accessible
  - Verify `S3_BUCKET` exists and is spelled correctly

#### 7. "CORS error in browser console"
- **Cause**: S3 bucket doesn't allow cross-origin requests from your domain
- **Solution**: Update S3 CORS configuration (see above)
- **Note**: Must match actual domain being accessed from

## Development Setup

### Local MinIO Setup

```bash
# Start MinIO in Docker
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# Create bucket
mc alias set minio http://localhost:9000 minioadmin minioadmin
mc mb minio/chinnahub

# Enable public access
mc policy set public minio/chinnahub
```

Then set environment variables:
```env
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=chinnahub
S3_ENDPOINT=http://localhost:9000
S3_ENABLE_PATH_STYLE=1
NEXT_PUBLIC_S3_DOMAIN=http://localhost:9000/chinnahub
```

### Testing Upload Functionality

1. Start the dev server: `npm run dev`
2. Navigate to Chat or Page Editor
3. Click the upload button (📎 icon in chat input or 📁 in page editor)
4. Select a file (image, video, audio, or document)
5. Monitor the upload dock in bottom right
6. Check browser console and server logs for errors

## File Upload Flow

1. **Client**: User selects file via upload UI
2. **Client**: File is validated (size, type)
3. **Client**: Request presigned URL from server via TRPC
4. **Server**: Validates file type and size again
5. **Server**: Generates S3 presigned URL with Content-Type
6. **Server**: Returns presigned URL to client
7. **Client**: Uploads file directly to S3 using presigned URL
8. **Client**: Creates file record in database
9. **Server**: Associates file with chat/page/document

## Security Considerations

1. **File Type Validation**: Both client and server validate file types
2. **Size Limits**: Enforced on server to prevent abuse
3. **Presigned URLs**: Expire after 1 hour
4. **Access Control**: S3 ACL set to private by default (`S3_SET_ACL=0`)
5. **Credentials**: Never stored in client-side code
6. **HTTPS**: Always use HTTPS in production

## Performance Optimization

1. **File Compression**: Images are automatically compressed before upload
2. **Concurrent Uploads**: Multiple files can be uploaded simultaneously
3. **Progress Tracking**: Real-time upload progress visible in UI
4. **Resume**: Aborted uploads can be restarted
5. **Caching**: Uploaded files use long-term cache headers

## Advanced Configuration

### Custom S3-Compatible Service

For any S3-compatible service (BackBlaze, DigitalOcean Spaces, etc):

```env
S3_ACCESS_KEY_ID=your_key
S3_SECRET_ACCESS_KEY=your_secret
S3_BUCKET=your_bucket
S3_REGION=your_region
S3_ENDPOINT=https://your-endpoint.com
# Enable path-style URLs if using non-AWS provider
S3_ENABLE_PATH_STYLE=1
```

### File Upload Timeout

By default, uploads have a 10-minute timeout. To adjust:

Edit `src/services/upload.ts` and modify the `uploadToServerS3` method XMLHttpRequest timeout setting.

### Storage Path Customization

Default path pattern: `files/{timestamp}/{uuid}.{ext}`

To customize, modify the `generateFilePathMetadata` function in `src/services/upload.ts`.

## Support

For issues or questions:
1. Check this guide first
2. Review server logs for error messages
3. Use the `testS3Connection` endpoint to diagnose configuration issues
4. Check browser console for client-side errors
5. Verify S3 credentials and permissions
