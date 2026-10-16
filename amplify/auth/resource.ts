import { defineAuth } from '@aws-amplify/backend';

/**
 * Cognito user pool for TeamTask AI.
 * @see https://docs.amplify.aws/react/build-a-backend/auth/
 */
export const auth = defineAuth({
  // Users sign in with their email address.
  loginWith: {
    email: true,
  },

  // Role groups. "Managers" = ADMIN + PROJECT_MANAGER (see data/resource.ts).
  groups: ['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'],
});
