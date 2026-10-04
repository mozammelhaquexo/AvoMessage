/**
 * When the server is allowed to echo an OTP back to the client.
 *
 * This is the one place a raw code can leave the server other than by email, so
 * it gets its own test rather than being covered incidentally.
 *
 * The rule is: only when the mailer cannot actually deliver the message. That
 * is what makes the code reach the inbox and nothing else in every real
 * configuration — the page, the browser's network tab and any proxy log along
 * the way all see the response, so echoing the code there would undo the point
 * of verifying the address at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { devCodeFor } from '@/lib/services/otp';

const original = {
  nodeEnv: process.env.NODE_ENV,
  driver: process.env.MAILER_DRIVER,
};

/**
 * Next's type augmentation declares `NODE_ENV` readonly, so it cannot be
 * assigned directly. The cast is the whole reason this helper exists.
 */
function setEnv(key: string, value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[key];
  else env[key] = value;
}

afterEach(() => {
  // `devCodeFor` reads process.env on every call, so these must not leak into
  // the DB-backed files that run in the same suite.
  setEnv('NODE_ENV', original.nodeEnv);
  setEnv('MAILER_DRIVER', original.driver);
});

describe('devCodeFor', () => {
  it('hands the code back under the log driver', () => {
    setEnv('NODE_ENV', 'test');
    setEnv('MAILER_DRIVER', 'log');
    expect(devCodeFor('123456')).toEqual({ devCode: '123456' });
  });

  it('defaults to the log driver when MAILER_DRIVER is unset', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('MAILER_DRIVER', undefined);
    expect(devCodeFor('123456')).toEqual({ devCode: '123456' });
  });

  it('withholds the code once a real driver can deliver it', () => {
    setEnv('NODE_ENV', 'development');
    for (const driver of ['smtp', 'resend', 'SMTP', 'Resend']) {
      setEnv('MAILER_DRIVER', driver);
      expect(devCodeFor('123456'), driver).toEqual({});
    }
  });

  it('withholds the code in production regardless of the driver', () => {
    setEnv('NODE_ENV', 'production');
    for (const driver of ['log', 'smtp', undefined]) {
      setEnv('MAILER_DRIVER', driver);
      expect(devCodeFor('123456'), String(driver)).toEqual({});
    }
  });
});
