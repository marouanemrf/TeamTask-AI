import { usePresence } from '../../hooks/usePresence';

export interface PresenceDotProps {
  email: string;
  className?: string;
  /**
   * Make the dot itself a keyboard stop so its tooltip can be read with Tab. Leave false when the
   * dot sits inside a link or button: the tooltip then also shows while that parent has focus.
   */
  focusable?: boolean;
}

/**
 * Presence from server heartbeats (see PresenceContext): Online green, Busy red, Offline gray.
 * Hover (or keyboard focus) shows a tooltip naming the same status the colour shows.
 */
export default function PresenceDot({ email, className = '', focusable = false }: PresenceDotProps) {
  const status = usePresence().status(email);
  const label = status === 'ONLINE' ? 'Online' : status === 'BUSY' ? 'Busy' : 'Offline';
  return (
    <span
      className={`presence-dot presence-dot--${status.toLowerCase()} ${className}`}
      role="img"
      aria-label={label}
      data-tooltip={label}
      tabIndex={focusable ? 0 : undefined}
    />
  );
}
