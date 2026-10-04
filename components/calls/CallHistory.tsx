/**
 * components/calls/CallHistory.tsx — the user's call history.
 *
 * Reads ONLY the participant-scoped `GET /api/calls/history` (the server
 * returns calls the viewer participated in — never anyone else's metadata).
 * Shows direction, participants, started-at, duration and status; the redial
 * button is rendered only when `onRedial` is provided, and redials the other
 * participant(s) of that call.
 *
 * Typical wiring (inside <CallProvider>):
 *
 *   const { startCall } = useCall();
 *   <CallHistory onRedial={(userIds) => startCall({ userIds, type: 'AUDIO' })} />
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
} from '@/components/ui';
import { formatDuration } from '@/lib/voice/recorder';
import { fetchCallHistory, type CallView } from '@/lib/webrtc/calls-api';

export interface CallHistoryProps {
  /** Redial with the other participant(s)' user ids. Omit to hide redial. */
  onRedial?: (userIds: string[]) => void;
  /** Id of the viewer, to determine call direction. */
  currentUserId: string;
  className?: string;
}

function callDuration(call: CallView): number | null {
  if (!call.endedAt) return null;
  const ms = new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime();
  return ms >= 0 ? ms : null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

type Direction = 'outgoing' | 'incoming' | 'missed';

function directionOf(call: CallView, currentUserId: string): Direction {
  const outgoing = call.initiator.id === currentUserId;
  if (!outgoing && (call.status === 'MISSED' || call.status === 'DECLINED')) {
    return 'missed';
  }
  return outgoing ? 'outgoing' : 'incoming';
}

function StatusLine({ call, currentUserId }: { call: CallView; currentUserId: string }) {
  const dir = directionOf(call, currentUserId);
  const duration = callDuration(call);
  const cls = dir === 'missed' ? 'text-danger-strong' : 'text-ink-3';
  const icon =
    dir === 'outgoing' ? 'phoneCall' : dir === 'missed' ? 'phoneOff' : 'phone';
  const label =
    call.status === 'MISSED' && dir === 'missed'
      ? 'Missed'
      : call.status === 'DECLINED'
        ? 'Declined'
        : call.status === 'FAILED'
          ? 'Failed'
          : dir === 'outgoing'
            ? 'Outgoing'
            : 'Incoming';
  return (
    <span className={`flex items-center gap-1 text-caption ${cls}`}>
      <Icon name={icon} className="h-3.5 w-3.5" aria-hidden />
      {label}
      {duration != null && duration > 0 && (
        <span aria-label={`duration ${formatDuration(duration)}`}>· {formatDuration(duration)}</span>
      )}
    </span>
  );
}

export function CallHistory({ onRedial, currentUserId, className }: CallHistoryProps) {
  const [calls, setCalls] = useState<CallView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string | null, append = false) => {
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const page = await fetchCallHistory(cursor ?? undefined);
      setCalls((prev) => (append ? [...prev, ...page.data] : page.data));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t load call history.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <LoadingState message="Loading call history…" className={className} />;
  }
  if (error) {
    return (
      <ErrorState
        title="Couldn’t load call history"
        message={error}
        onRetry={() => void load()}
        className={className}
      />
    );
  }
  if (calls.length === 0) {
    return (
      <EmptyState
        icon="phoneCall"
        title="No calls yet"
        description="Your call history will appear here. Start a call from any conversation."
        className={className}
      />
    );
  }

  return (
    <div className={className} role="list" aria-label="Call history">
      {calls.map((call) => {
        const others = call.participants.filter((p) => p.user.id !== currentUserId);
        const names = others.map((p) => p.user.name);
        const title =
          names.length === 0
            ? 'Unknown'
            : names.length === 1
              ? names[0]!
              : `${names[0]} +${names.length - 1}`;
        const avatarUrl = others[0]?.user.avatarUrl ?? null;
        const dir = directionOf(call, currentUserId);
        return (
          <div
            key={call.id}
            role="listitem"
            className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
          >
            <Avatar src={avatarUrl} name={title} size="md" />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-body-sm font-medium ${dir === 'missed' ? 'text-danger-strong' : 'text-ink'}`}>
                {title}
              </p>
              <StatusLine call={call} currentUserId={currentUserId} />
              <p className="text-caption text-ink-3">{formatDate(call.startedAt)}</p>
            </div>
            {onRedial && others.length > 0 && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Call ${title} back`}
                title="Redial"
                onClick={() => onRedial(others.map((p) => p.user.id))}
              >
                <Icon name="phone" className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        );
      })}
      {nextCursor && (
        <div className="flex justify-center py-3">
          <Button
            size="sm"
            variant="outline"
            loading={loadingMore}
            onClick={() => void load(nextCursor, true)}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
