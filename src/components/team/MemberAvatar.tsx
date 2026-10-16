import { useState } from "react";
import { useAvatarUrl } from "../../hooks/useTeam";
import { initials } from "../../utils/text";

export interface MemberAvatarProps {
  name: string;
  avatarKey?: string | null;
  size?: "sm" | "md" | "lg";
  /** A local preview (e.g. a freshly chosen file) that overrides the stored picture. */
  previewUrl?: string | null;
}

/**
 * Profile picture, or initials when there is none (or it fails to load).
 * Decorative: the member's name is always shown next to it.
 */
function MemberAvatar({ name, avatarKey, size = "md", previewUrl }: MemberAvatarProps) {
  const storedUrl = useAvatarUrl(previewUrl ? null : avatarKey);
  const url = previewUrl ?? storedUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (url && url !== failedUrl) {
    return <img className={`avatar avatar--${size}`} src={url} alt="" onError={() => setFailedUrl(url)} />;
  }
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export default MemberAvatar;
