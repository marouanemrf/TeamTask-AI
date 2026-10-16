import { useCallback, useMemo, useState } from "react";
import type { TeamMember } from "../services/client";
import { removeOwnProfilePhoto, updateMyProfile, uploadOwnProfilePhoto } from "../services/profileService";
import type { ProfileInput } from "../services/profileService";
import { describeApiError } from "../utils/apiErrors";
import { toSquareAvatar, validateImageFile } from "../utils/image";
import { normalizeEmail } from "../utils/text";
import { useTeamMembers } from "./useTeam";
import { useUser } from "./useUser";

/** The signed-in user's own team profile, with save and photo upload. Errors are user-facing. */
export function useMyProfile() {
  const { email } = useUser();
  const { members, loading } = useTeamMembers();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const member: TeamMember | undefined = useMemo(
    () => (email ? members.find((m) => normalizeEmail(m.email) === normalizeEmail(email)) : undefined),
    [members, email],
  );

  /** Saves the profile; removes the previous photo if it was replaced and was the user's own upload. */
  const save = useCallback(
    async (input: ProfileInput): Promise<boolean> => {
      setSaving(true);
      setError(null);
      const previousPhoto = member?.avatarKey;
      try {
        await updateMyProfile(input);
        if (input.avatarKey !== undefined && previousPhoto && previousPhoto !== input.avatarKey) {
          await removeOwnProfilePhoto(previousPhoto);
        }
        return true;
      } catch (err) {
        console.error("[useMyProfile] Save failed", err);
        setError(describeApiError(err));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [member?.avatarKey],
  );

  /** Validates, crops and uploads a new photo; resolves to its storage path (not saved yet). */
  const uploadPhoto = useCallback(async (file: File): Promise<string | null> => {
    const problem = validateImageFile(file);
    if (problem) {
      setError(problem);
      return null;
    }
    setUploading(true);
    setError(null);
    try {
      return await uploadOwnProfilePhoto(await toSquareAvatar(file));
    } catch (err) {
      console.error("[useMyProfile] Photo upload failed", err);
      setError("The photo could not be uploaded. Please try again.");
      return null;
    } finally {
      setUploading(false);
    }
  }, []);

  return { email, member, loading, save, uploadPhoto, saving, uploading, error, setError };
}
