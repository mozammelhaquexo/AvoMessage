import { NextRequest, NextResponse } from 'next/server';
import { ValidationError, created, handle } from '@/lib/api';
import { requireSession, requireVerified } from '@/lib/permissions';
import { processUpload } from '@/lib/services/uploads';

/**
 * POST /api/uploads — multipart form: `file` (required), `kind`
 * (avatar|cover|post|message|voice|company-logo). Validated server-side
 * (MIME, extension, size, magic bytes) before hitting the storage driver.
 */
export const POST = handle(
  async (req: NextRequest): Promise<NextResponse> => {
    const { user } = await requireSession(req);
    requireVerified(user);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ValidationError('Expected multipart form data');
    }
    const file = form.get('file');
    const kind = form.get('kind');
    if (!(file instanceof File)) {
      throw new ValidationError('Missing file', { file: ['A file is required'] });
    }
    if (typeof kind !== 'string' || !kind) {
      throw new ValidationError('Missing kind', { kind: ['Upload kind is required'] });
    }
    return created(await processUpload(file, kind));
  },
  { rateLimit: 'upload' },
);
