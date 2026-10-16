import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useUser } from '../hooks/useUser';
import { observePresence, sendHeartbeat } from '../services/presenceService';
import type { OwnPresence, PresenceRow } from '../services/presenceService';
import { PresenceContext } from './presenceContextValue';
import type { PresenceContextValue } from './presenceContextValue';


const HEARTBEAT_MS = 30_000;
/** No input for this long = inactive: heartbeats stop and the user turns Offline for others. */
const INACTIVE_MS = 5 * 60_000;
/** A user is Online/Busy only if their last heartbeat is more recent than this. */
const STALE_MS = 90_000;
const STORAGE_KEY = 'teamtask-presence';

function readStoredStatus(): OwnPresence {
  try { return localStorage.getItem(STORAGE_KEY) === 'BUSY' ? 'BUSY' : 'ONLINE'; } catch { return 'ONLINE'; }
}

/**
 * Presence from server-recorded heartbeats, not a manual flag: a signed-in, visible and active
 * tab sends one every 30 s; others see Offline when none arrived in the last 90 s (tab closed,
 * signed out, hidden, or idle for 5 minutes). The manual choice only switches Online ↔ Busy.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { email } = useUser();
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [ownStatus, setOwnStatusState] = useState<OwnPresence>(readStoredStatus);
  const [now, setNow] = useState(() => Date.now());
  const lastActivity = useRef(0); // set when the heartbeat effect starts

  useEffect(() => observePresence(setRows, (error) => console.warn('[Presence] subscription failed', error)), []);

  // Re-evaluate staleness even when no new rows arrive.
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), HEARTBEAT_MS); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    if (!email) return;
    lastActivity.current = Date.now();
    const isActive = () => document.visibilityState === 'visible' && Date.now() - lastActivity.current < INACTIVE_MS;
    const beat = () => { if (isActive()) void sendHeartbeat(ownStatus); };
    const onActivity = () => {
      const wasInactive = Date.now() - lastActivity.current >= INACTIVE_MS;
      lastActivity.current = Date.now();
      if (wasInactive) beat(); // coming back after a pause: show Online right away
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') { lastActivity.current = Date.now(); beat(); } };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    return () => {
      window.clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [email, ownStatus]);

  const value = useMemo<PresenceContextValue>(() => ({
    ownStatus,
    setOwnStatus: (status) => {
      try { localStorage.setItem(STORAGE_KEY, status); } catch { /* storage unavailable: keep it for this session */ }
      setOwnStatusState(status);
    },
    status: (target) => {
      const row = rows.find((item) => item.email.toLowerCase() === target.toLowerCase());
      if (!row || now - Date.parse(row.lastSeenAt) > STALE_MS) return 'OFFLINE';
      return row.status === 'BUSY' ? 'BUSY' : 'ONLINE';
    },
  }), [rows, ownStatus, now]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}
