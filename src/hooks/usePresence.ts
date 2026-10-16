import { useContext } from 'react';
import { PresenceContext } from '../context/presenceContextValue';

/** Presence of any member and the user's own Online/Busy choice. Must be used inside <PresenceProvider>. */
export function usePresence() {
  const value = useContext(PresenceContext);
  if (!value) throw new Error('usePresence must be used within PresenceProvider');
  return value;
}
