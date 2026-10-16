import { fetchAuthSession } from "aws-amplify/auth";
import { remove, uploadData } from "aws-amplify/storage";
import { ApiError } from "./apiError";
import { client } from "./client";
import type { TeamMember } from "./client";

/** Fields the signed-in user can edit on their own profile (server: manage-profile function). */
export interface ProfileInput {
  name: string;
  phoneNumber?: string;
  jobTitle?: string;
  skills: string[];
  experience?: string;
  education?: string;
  professionalSummary?: string;
  /** null removes the photo; undefined keeps it. */
  avatarKey?: string | null;
}

/** Folder of the caller's own photos: only they can write there (storage rule on {entity_id}). */
async function ownPhotoFolder(): Promise<string> {
  const { identityId } = await fetchAuthSession();
  if (!identityId) throw new ApiError("Profile photo uploads are not available for this session.");
  return `profile-avatars/${identityId}/`;
}

/** Uploads an already-resized image to the caller's own folder and returns its storage path. */
export async function uploadOwnProfilePhoto(image: Blob): Promise<string> {
  const path = `${await ownPhotoFolder()}${crypto.randomUUID()}.${image.type === "image/webp" ? "webp" : "jpg"}`;
  await uploadData({ path, data: image, options: { contentType: image.type } }).result;
  return path;
}

/** Saves the caller's profile. The server matches the profile by the signed-in email. */
export async function updateMyProfile(input: ProfileInput): Promise<TeamMember> {
  const { data, errors } = await client.mutations.updateMyProfile(input);
  if (!data || errors?.length) throw ApiError.from(errors, "Profile update failed");
  return data;
}

/** Best effort: deletes a previous photo if it was one of the caller's own uploads. */
export async function removeOwnProfilePhoto(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    if (!path.startsWith(await ownPhotoFolder())) return; // manager-uploaded photos are not ours to delete
    await remove({ path });
  } catch (err) {
    console.warn("[profileService] Old photo cleanup failed", err);
  }
}
