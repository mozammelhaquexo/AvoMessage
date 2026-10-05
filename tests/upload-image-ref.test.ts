/**
 * Two guards for the bug that took uploads off the live site.
 *
 * The failure had two halves, and either one alone breaks the feature:
 *
 *  1. **The files were not in git.** `.gitignore` had a bare `uploads/` line.
 *     A gitignore pattern with no leading slash matches at every depth, so it
 *     swallowed `app/api/uploads/` along with the runtime `storage/uploads/`.
 *     Both route files existed on disk and were never committed. A CLI deploy
 *     uploads the working tree and hid this; the first git-sourced Vercel
 *     build had no upload endpoint at all — `POST /api/uploads` answered 404
 *     "Server action not found."
 *
 *  2. **The schema rejected what the uploader returns.** `POST /api/uploads`
 *     answers with `{ url: "/uploads/avatar/…" }`, but `avatarUrl` and
 *     `coverUrl` were `z.string().url()`, which refuses a relative path. So
 *     even with the route present, saving the new picture failed with
 *     "Invalid URL".
 *
 * Together those produced "Request failed (404)" when changing a profile photo
 * or a company logo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { updateProfileSchema } from '@/lib/validation';

describe('uploaded image references', () => {
  const UPLOADED = '/uploads/avatar/2026/10/4e3c735a-a2d7-4cc2-bfdc-a7389acbc9b5.png';

  it('accepts the path POST /api/uploads actually returns', () => {
    const parsed = updateProfileSchema.safeParse({ avatarUrl: UPLOADED });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.avatarUrl).toBe(UPLOADED);
  });

  it('accepts a relative cover path too', () => {
    const parsed = updateProfileSchema.safeParse({ coverUrl: '/uploads/cover/2026/10/x.jpg' });
    expect(parsed.success).toBe(true);
  });

  it('still accepts an absolute http(s) URL', () => {
    expect(updateProfileSchema.safeParse({ avatarUrl: 'https://cdn.example.com/a.png' }).success).toBe(
      true,
    );
    expect(updateProfileSchema.safeParse({ avatarUrl: 'http://cdn.example.com/a.png' }).success).toBe(
      true,
    );
  });

  it('refuses a protocol-relative URL, which points at another origin', () => {
    expect(updateProfileSchema.safeParse({ avatarUrl: '//evil.example.com/a.png' }).success).toBe(
      false,
    );
  });

  it('refuses a non-http scheme and plain text', () => {
    expect(updateProfileSchema.safeParse({ avatarUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ avatarUrl: 'data:image/png;base64,AAAA' }).success).toBe(
      false,
    );
    expect(updateProfileSchema.safeParse({ avatarUrl: 'not a url' }).success).toBe(false);
  });

  it('still treats an empty string as "not provided"', () => {
    const parsed = updateProfileSchema.safeParse({ avatarUrl: '' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.avatarUrl).toBeUndefined();
  });

  it('keeps the website field strict — that one is a real external link', () => {
    expect(updateProfileSchema.safeParse({ website: '/uploads/a.png' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ website: 'https://example.com' }).success).toBe(true);
  });
});

describe('the repository contains every source file the app needs', () => {
  const ROOT = process.cwd();
  const SOURCE_DIRS = ['app', 'components', 'lib'];

  /**
   * Every directory under `sourceDirs` whose name is a bare `name/` pattern in
   * `.gitignore`.
   *
   * This is the rule that broke the deploy, expressed without shelling out to
   * git: a gitignore pattern with no leading slash matches at EVERY depth, so
   * a line meant for `storage/uploads/` also matched `app/api/uploads/` and
   * took the upload API out of the repository. Anything this returns is a
   * source directory git will not deploy.
   */
  function sourceDirsShadowedByGitignore(): string[] {
    const patterns = readFileSync(join(ROOT, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
      // Bare `name/` only — anchored (`/name/`) or globbed patterns are scoped
      // on purpose and cannot leak into the source tree.
      .filter((l) => /^[A-Za-z0-9._-]+\/$/.test(l))
      .map((l) => l.slice(0, -1));

    const hits: string[] = [];
    const walk = (dir: string) => {
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name === 'node_modules' || e.name === '.next') continue;
        const full = join(dir, e.name);
        if (patterns.includes(e.name)) hits.push(relative(ROOT, full).replace(/\\/g, '/'));
        walk(full);
      }
    };
    for (const d of SOURCE_DIRS) walk(join(ROOT, d));
    return hits;
  }

  it('has no source directory shadowed by a bare .gitignore pattern', () => {
    expect(sourceDirsShadowedByGitignore()).toEqual([]);
  });

  it('keeps both upload route files on disk', () => {
    expect(existsSync(join(ROOT, 'app/api/uploads/route.ts'))).toBe(true);
    expect(existsSync(join(ROOT, 'app/api/uploads/[...path]/route.ts'))).toBe(true);
  });

  /**
   * The authoritative check — is the file actually in git? Skipped where git
   * cannot be spawned (the agent sandbox returns EBUSY), rather than silently
   * passing.
   */
  function gitAvailable(): boolean {
    try {
      execFileSync('git', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  it.skipIf(!gitAvailable())('tracks both upload route files in git', () => {
    const tracked = execFileSync('git', ['ls-files', 'app/api/uploads'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    expect(tracked).toContain('app/api/uploads/route.ts');
    expect(tracked).toContain('app/api/uploads/[...path]/route.ts');
  });

  it.skipIf(!gitAvailable())('leaves no ignored file under app/, components/ or lib/', () => {
    const out = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', ...SOURCE_DIRS],
      { encoding: 'utf8', cwd: ROOT },
    );
    expect(out.split('\n').filter(Boolean)).toEqual([]);
  });
});
