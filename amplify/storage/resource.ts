import { defineStorage } from '@aws-amplify/backend';

/**
 * S3 bucket for team member profile pictures and task attachments.
 * - avatars/*                       uploaded by managers from the Team page (any member).
 * - task-attachments/<taskId>/*     task documents (10 MB max, checked by the app).
 * - profile-avatars/{entity_id}/*   uploaded by each user for their own profile (self-service).
 * Any signed-in user can view both. The two prefixes must not overlap: Amplify rejects a path
 * that is a prefix of an {entity_id} path.
 * Users in a Cognito group get that group's IAM role instead of the "authenticated" role, so every
 * group is granted read here too, and backend.ts gives each group role write access to its own
 * profile-avatars/{identity id}/ folder (allow.entity only reaches the authenticated role).
 * @see https://docs.amplify.aws/react/build-a-backend/storage/
 */
export const storage = defineStorage({
  name: 'teamtaskAvatars',
  access: (allow) => ({
    'avatars/*': [
      allow.groups(['ADMIN', 'PROJECT_MANAGER']).to(['read', 'write', 'delete']),
      allow.groups(['MEMBER', 'VIEWER']).to(['read']),
      allow.authenticated.to(['read']),
    ],
    // Task documents: managers and members add files, managers delete them, everyone signed in reads.
    'task-attachments/*': [
      allow.groups(['ADMIN', 'PROJECT_MANAGER']).to(['read', 'write', 'delete']),
      allow.groups(['MEMBER']).to(['read', 'write']),
      allow.groups(['VIEWER']).to(['read']),
      allow.authenticated.to(['read']),
    ],
    'profile-avatars/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.groups(['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER']).to(['read']),
      allow.authenticated.to(['read']),
    ],
  }),
});
