/**
 * lib/voice/upload.ts — upload a recorded voice blob to `POST /api/uploads`.
 *
 * Server-side validation (MIME, extension, size, magic bytes) happens in
 * `lib/storage/validate.ts`; the client only picks a sane filename/extension
 * from the negotiated MIME type. Returns the upload record, which the caller
 * attaches to a `messageType: VOICE` message.
 */
'use client';

import { apiUpload } from '@/lib/api-client';

export interface UploadedVoice {
  id: string;
  url: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
}

function extensionFor(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/mp4':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/webm':
    default:
      return 'webm';
  }
}

/** Upload a voice recording; resolves with the server's upload record. */
export async function uploadVoice(blob: Blob, durationMs: number): Promise<UploadedVoice> {
  const ext = extensionFor(blob.type || 'audio/webm');
  const filename = `voice-${Date.now()}-${Math.round(durationMs)}ms.${ext}`;
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('kind', 'voice');

  return apiUpload<UploadedVoice>('/api/uploads', form);
}
