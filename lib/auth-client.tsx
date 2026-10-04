/**
 * lib/auth-client.tsx — browser auth context for AvoMessage.
 *
 * Owned by Frontend Engineer A.
 *
 * `AuthProvider` owns the current session user. `useSession()` is the primary
 * hook (returns `{ user, loading, … }`); `useAuth()` is an alias kept for
 * existing call sites. The provider accepts an optional `initialUser` so
 * server layouts can seed the session without a client round-trip.
 *
 * Session transport: httpOnly `avo_session` cookie + `credentials: "include"`;
 * no token ever touches JS. CSRF is handled by lib/api-client.ts.
 */
"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiGet, apiPost, ApiError } from "./api-client";
import type { SessionUser } from "./api-types";
import type { OtpChallenge } from "./otp-client";

interface SessionResponse {
  user: SessionUser;
  session?: { id: string; createdAt: string; lastActiveAt: string };
}

interface LoginResponse {
  user: SessionUser;
  emailVerified: boolean;
}

interface AuthContextValue {
  /** `undefined` = still loading; `null` = not signed in. */
  user: SessionUser | undefined | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<LoginResponse>;
  /**
   * Step 1 of signup — send a code. Returns the challenge to verify against.
   *
   * There is deliberately no single-call `signup()`: the account must not exist
   * before the address is proven, so creating one and sending the code are two
   * separate server operations and the client mirrors that.
   */
  requestSignup: (input: {
    name: string;
    username: string;
    email: string;
    password: string;
  }) => Promise<OtpChallenge>;
  /** Step 2 of signup — a correct code creates the account and the session. */
  verifySignupOtp: (challengeId: string, code: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Merge fields into the cached user (e.g. after a profile update). */
  updateUser: (patch: Partial<SessionUser>) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: undefined,
  loading: true,
  error: null,
  login: async () => {
    throw new Error("AuthProvider not mounted");
  },
  requestSignup: async () => {
    throw new Error("AuthProvider not mounted");
  },
  verifySignupOtp: async () => {
    throw new Error("AuthProvider not mounted");
  },
  logout: async () => undefined,
  refresh: async () => undefined,
  updateUser: () => undefined,
});

/** Primary hook — session user, loading state, and auth actions. */
export function useSession(): AuthContextValue {
  return useContext(AuthContext);
}

/** Alias kept for existing call sites. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

function friendlyLoginError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "INVALID_CREDENTIALS":
        return "Wrong email or password. Please try again.";
      case "EMAIL_UNVERIFIED":
        return "Please verify your email before signing in.";
      case "ACCOUNT_SUSPENDED":
        return "This account has been suspended.";
      case "ACCOUNT_LOCKED":
        return "Too many attempts — this account is temporarily locked. Try again later.";
      case "RATE_LIMITED":
        return "Too many attempts. Please wait a moment and try again.";
      default:
        return e.message;
    }
  }
  return "Sign-in failed. Please try again.";
}

export function AuthProvider({
  children,
  initialUser = undefined,
}: {
  children: ReactNode;
  /** Seed from a server layout — skips the initial /api/auth/me round-trip. */
  initialUser?: SessionUser | null;
}) {
  const [user, setUser] = useState<SessionUser | undefined | null>(initialUser);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<SessionResponse>("/api/auth/me");
      if (!mountedRef.current) return;
      setUser(res.user);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof ApiError && e.status === 401) {
        // No session (or expired) — not an error state, just signed out.
        setUser(null);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load session");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Only fetch when the server didn't seed a user (public pages, or the
    // seeded session expired between SSR and hydration). This is the
    // canonical fetch-on-mount pattern: there is no user event to hoist it into.
    if (initialUser === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only session fetch
      void refresh();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [initialUser, refresh]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await apiPost<LoginResponse>("/api/auth/login", { email, password });
      setUser(res.user);
      setError(null);
      return res;
    } catch (e) {
      const message = friendlyLoginError(e);
      setError(message);
      throw new Error(message);
    }
  }, []);

  /**
   * Signup, step 1. The server validates the form, checks the address and
   * username are free, hashes the password and parks the whole pending account
   * on an OTP challenge — no user row yet. The response is 202 Accepted.
   *
   * Errors are translated the same way the old one-shot signup did, because the
   * failure modes are the same ones: a taken email/username (409) and field
   * validation (400).
   */
  const requestSignup = useCallback(
    async (input: { name: string; username: string; email: string; password: string }) => {
      try {
        const res = await apiPost<OtpChallenge>("/api/auth/register", input);
        setError(null);
        return res;
      } catch (e) {
        let message = "Sign-up failed. Please try again.";
        if (e instanceof ApiError) {
          if (e.code === "VALIDATION_ERROR" && e.fields) {
            const first = Object.values(e.fields)[0]?.[0];
            message = first ?? "Please check the highlighted fields.";
          } else if (e.code === "CONFLICT") {
            message = e.message || "That email or username is already taken.";
          } else {
            message = e.message;
          }
        }
        setError(message);
        throw new Error(message);
      }
    },
    [],
  );

  /**
   * Signup, step 2. A correct code is what brings the account into existence —
   * the server reads the name, username, email and password hash back off the
   * challenge, so this call carries nothing but the id and the code.
   *
   * On success the account is already email-verified (the code proved the
   * address), so there is no verification link to follow.
   */
  const verifySignupOtp = useCallback(async (challengeId: string, code: string) => {
    const res = await apiPost<{ user: SessionUser }>("/api/auth/signup/verify", {
      challengeId,
      code,
    });
    setUser(res.user);
    setError(null);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost("/api/auth/logout");
    } catch {
      // Logout is best-effort client-side; the server clears what it can.
    } finally {
      setUser(null);
      // Route-group change re-runs the (public) layout with a null session.
      router.push("/login");
      router.refresh();
    }
  }, [router]);

  const updateUser = useCallback((patch: Partial<SessionUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading: user === undefined,
      error,
      login,
      requestSignup,
      verifySignupOtp,
      logout,
      refresh,
      updateUser,
    }),
    [user, error, login, requestSignup, verifySignupOtp, logout, refresh, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** True when the signed-in user is a platform admin (ADMIN or SUPER_ADMIN). UX-only; enforcement is server-side. */
export function useIsAdmin(): boolean {
  const { user } = useSession();
  return !!user && (user.platformRole === "ADMIN" || user.platformRole === "SUPER_ADMIN");
}
