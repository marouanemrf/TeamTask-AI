import { env } from '$amplify/env/manage-profile';
import type { Schema } from '../../data/resource';
import { check, createDataClient } from '../shared/data';
import { fail } from '../shared/errors';
import { runMutation } from '../shared/handler';
const db = await createDataClient(env);
export const handler: Schema['updateMyProfile']['functionHandler'] = (event) => runMutation('update-my-profile', event, async (caller, args) => {
  const phone = args.phoneNumber?.trim();
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) fail('VALIDATION', 'Enter a valid phone number.');
  for (const value of [args.name, args.jobTitle, args.experience, args.education, args.professionalSummary]) if (value && value.length > 5000) fail('VALIDATION', 'A profile field is longer than allowed.');
  if ((args.skills ?? []).some((skill) => !skill?.trim() || skill.length > 80)) fail('VALIDATION', 'A skill is empty or too long.');
  // Self-service photos live under profile-avatars/<identityId>/ (only the owner can write there).
  const OWN_PHOTO = /^profile-avatars\/[A-Za-z0-9:_-]+\/[A-Za-z0-9._-]+$/;
  let token: string | null | undefined;
  do {
    const page = await db.models.TeamMember.list({ nextToken: token, limit: 1000 });
    const mine = check(page, 'TeamMember.list').find((m) => m.email.toLowerCase() === caller.email);
    if (mine) {
      // A new photo must be a self-service upload; keeping the current one (even if a manager set it) is fine.
      if (args.avatarKey && args.avatarKey !== mine.avatarKey && !OWN_PHOTO.test(args.avatarKey)) fail('VALIDATION', 'Chemin de photo invalide.');
      const updated = check(await db.models.TeamMember.update({ id: mine.id, name: args.name?.trim() || mine.name, phoneNumber: phone || null, jobTitle: args.jobTitle?.trim() || null, skills: args.skills ?? mine.skills ?? [], experience: args.experience?.trim() || null, education: args.education?.trim() || null, professionalSummary: args.professionalSummary?.trim() || null, avatarKey: args.avatarKey === undefined ? mine.avatarKey : args.avatarKey }), 'TeamMember.update');
      if (!updated) fail('NOT_FOUND', 'Votre profil est introuvable.');
      return updated;
    }
    token = page.nextToken;
  } while (token);
  fail('NOT_FOUND', "Your team profile wasn't found. Contact an administrator.");
});
