/**
 * RBAC.md references `lib/auth/permissions.ts`; the canonical implementation
 * lives in `lib/permissions.ts` (per the build task). This module re-exports
 * it so both import paths work for Backend Engineer B and future code.
 */
export * from '@/lib/permissions';
