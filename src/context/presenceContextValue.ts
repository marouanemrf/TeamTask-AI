import { createContext } from 'react';
import type { OwnPresence } from '../services/presenceService';

export type PresenceState = 'ONLINE' | 'BUSY' | 'OFFLINE';
export interface PresenceContextValue { status: (email: string) => PresenceState; ownStatus: OwnPresence; setOwnStatus: (status: OwnPresence) => void }
export const PresenceContext = createContext<PresenceContextValue | null>(null);
