/**
 * Uploads service: validates (MIME/extension/size/magic, server-side) then
 * stores via the configured StorageDriver. Uploads are unattached until
 * referenced (avatarUrl, post media, ...); the returned `id` is the storage key.
 */
import { getStorage, validateUpload, UploadValidationError } from '@/lib/storage';
import { ValidationError } from '@/lib/api';
import { uploadKindSchema, type UploadKind } from '@/lib/validation';

export interface UploadedFile {
  id: string; // storage key
  url: string;
  kind: UploadKind;
  mimeType: string;
  sizeBytes: number;
}

const MAX_FORM_BYTES = 110 * 1024 * 1024; // hard ceiling above the largest kind (100MB)

export async function processUpload(
  file: File,
  kindRaw: string,
): Promise<UploadedFile> {
  const parsed = uploadKindSchema.safeParse(kindRaw);
  if (!parsed.success) {
    throw new ValidationError('Invalid upload kind', {
      kind: ['Must be one of: avatar, cover, post, message, voice, company-logo'],
    });
  }
  const kind = parsed.data;

  if (file.size === 0) throw new ValidationError('Empty file');
  if (file.size > MAX_FORM_BYTES) throw new ValidationError('File too large');

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';

  let validated;
  try {
    validated = validateUpload(kind, file.name || 'file', mimeType, buffer);
  } catch (e) {
    if (e instanceof UploadValidationError) throw new ValidationError(e.message);
    throw e;
  }

  const { url } = await getStorage().put(validated.key, buffer, {
    contentType: validated.mimeType,
    size: validated.sizeBytes,
  });

  return {
    id: validated.key,
    url,
    kind,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
  };
}
