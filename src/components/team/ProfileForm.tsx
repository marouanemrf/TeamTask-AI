import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { TeamMember } from "../../services/client";
import type { ProfileInput } from "../../services/profileService";
import type { OwnPresence } from "../../services/presenceService";
import { AVATAR_ACCEPT } from "../../utils/image";
import MemberAvatar from "./MemberAvatar";
import PresenceDot from "./PresenceDot";
import SkillsInput from "./SkillsInput";
import { useToastMessage } from "../../hooks/useToast";

const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;

export interface ProfileFormProps {
  member: TeamMember;
  email: string | null;
  saving: boolean;
  uploading: boolean;
  error: string | null;
  ownStatus: OwnPresence;
  onStatusChange: (status: OwnPresence) => void;
  onUploadPhoto: (file: File) => Promise<string | null>;
  onSave: (input: ProfileInput) => Promise<boolean>;
  /** Administrators set their own job title; for everyone else it is read-only (set by managers). */
  canEditJobTitle?: boolean;
}

/**
 * The user's own professional profile: photo, contact, title, summary, experience, education, skills.
 * Initialised from `member`; the page remounts it (key = id + updatedAt) when a newer version is saved.
 */
function ProfileForm({ member, email, saving, uploading, error, ownStatus, onStatusChange, onUploadPhoto, onSave, canEditJobTitle = false }: ProfileFormProps) {
  const id = useId();
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(member.phoneNumber ?? "");
  // Editable by administrators only; for others it is shown greyed out and sent back unchanged.
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? "");
  const [summary, setSummary] = useState(member.professionalSummary ?? "");
  const [experience, setExperience] = useState(member.experience ?? "");
  const [education, setEducation] = useState(member.education ?? "");
  const [skills, setSkills] = useState<string[]>((member.skills ?? []).filter((s): s is string => !!s));
  const [avatarKey, setAvatarKey] = useState<string | null>(member.avatarKey ?? null);
  const [awayFrom, setAwayFrom] = useState(member.unavailableFrom ?? "");
  const [awayUntil, setAwayUntil] = useState(member.unavailableUntil ?? "");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string; away?: string }>({});
  const [notice, setNotice] = useState<string | null>(null);
  useToastMessage(notice, "success", () => setNotice(null));
  useToastMessage(error, "error");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const errors: typeof fieldErrors = {};
    if (!name.trim()) errors.name = "Name is required.";
    if (phone.trim() && !PHONE_PATTERN.test(phone.trim())) errors.phone = "Enter a valid phone number (digits, spaces, +, - or parentheses).";
    if (awayFrom && awayUntil && awayUntil < awayFrom) errors.away = "The end of the absence must be on or after its start.";
    setFieldErrors(errors);
    if (errors.name) return document.getElementById(`${id}-name`)?.focus();
    if (errors.phone) return document.getElementById(`${id}-phone`)?.focus();
    if (errors.away) return document.getElementById(`${id}-away-until`)?.focus();
    const saved = await onSave({
      name: name.trim(),
      phoneNumber: phone.trim(),
      jobTitle: jobTitle.trim(),
      professionalSummary: summary.trim(),
      experience: experience.trim(),
      education: education.trim(),
      skills,
      avatarKey,
      unavailableFrom: awayFrom || null,
      unavailableUntil: awayUntil || null,
    });
    if (saved) setNotice("Profile saved.");
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    const key = await onUploadPhoto(file);
    if (key) setAvatarKey(key);
  }

  const invalid = (field: "name" | "phone") => ({
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `${id}-${field}-error` : undefined,
  });

  return (
    <form className="panel profile-editor" onSubmit={(e) => void handleSubmit(e)} noValidate aria-busy={saving}>
      <div className="profile-editor__heading">
        <span className="avatar-presence avatar-presence--large">
          <MemberAvatar name={name || member.name} avatarKey={avatarKey} size="lg" />
          {email && <PresenceDot email={email} focusable />}
        </span>
        <div>
          <h2 className="panel__title">Professional profile</h2>
          <p className="text-muted">{email}</p>
        </div>
      </div>

      <div className="photo-field__buttons">
        <input
          id={`${id}-photo`}
          className="visually-hidden file-input"
          type="file"
          accept={AVATAR_ACCEPT}
          onChange={(e) => {
            void handlePhoto(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <label htmlFor={`${id}-photo`} className="button-secondary">
          {uploading ? "Uploading…" : avatarKey ? "Change photo" : "Upload photo"}
        </label>
        {avatarKey && (
          <button type="button" className="button-secondary" onClick={() => setAvatarKey(null)} disabled={uploading}>
            Remove photo
          </button>
        )}
        <span className="form-hint">JPG, PNG, WebP or GIF up to 5 MB. Saved with the profile.</span>
      </div>

      <fieldset className="modal__fields" disabled={saving}>
        <legend className="visually-hidden">Profile details</legend>
        <div className="modal__row">
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-name`}>Name <span aria-hidden="true">*</span></label>
            <input id={`${id}-name`} className="form-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required {...invalid("name")} />
            {fieldErrors.name && <p id={`${id}-name-error`} className="form-field__error">{fieldErrors.name}</p>}
          </div>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-phone`}>Phone</label>
            <input id={`${id}-phone`} className="form-input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+212 6 12 34 56 78" {...invalid("phone")} />
            {fieldErrors.phone && <p id={`${id}-phone-error`} className="form-field__error">{fieldErrors.phone}</p>}
          </div>
        </div>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-job`}>Job title</label>
          {canEditJobTitle ? (
            <input id={`${id}-job`} className="form-input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={200} />
          ) : (
            <>
              <input id={`${id}-job`} className="form-input form-input--locked" value={jobTitle || "Not set"} disabled readOnly aria-describedby={`${id}-job-hint`} />
              <p id={`${id}-job-hint`} className="form-hint">Your job title can't be changed from your profile.</p>
            </>
          )}
        </div>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-summary`}>Professional summary</label>
          <textarea id={`${id}-summary`} className="form-input form-textarea" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={5000} />
        </div>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-experience`}>Experience</label>
          <textarea id={`${id}-experience`} className="form-input form-textarea" rows={5} value={experience} onChange={(e) => setExperience(e.target.value)} maxLength={5000} placeholder="One role per line: title, company, dates, key achievements." />
        </div>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-education`}>Education</label>
          <textarea id={`${id}-education`} className="form-input form-textarea" rows={3} value={education} onChange={(e) => setEducation(e.target.value)} maxLength={5000} placeholder="Degrees and certifications, one per line." />
        </div>
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-skills`}>Skills</label>
          <SkillsInput id={`${id}-skills`} skills={skills} onChange={setSkills} />
        </div>
        <fieldset className="form-field">
          <legend className="form-field__label">Planned absence</legend>
          <p id={`${id}-away-hint`} className="form-hint">Leave, training… You won't be suggested as owner for tasks due in this period. Leave empty if none.</p>
          <div className="modal__row">
            <div className="form-field">
              <label className="form-field__label" htmlFor={`${id}-away-from`}>From</label>
              <input id={`${id}-away-from`} className="form-input" type="date" value={awayFrom} onChange={(e) => setAwayFrom(e.target.value)} aria-describedby={`${id}-away-hint`} />
            </div>
            <div className="form-field">
              <label className="form-field__label" htmlFor={`${id}-away-until`}>Until</label>
              <input id={`${id}-away-until`} className="form-input" type="date" value={awayUntil} min={awayFrom || undefined} onChange={(e) => setAwayUntil(e.target.value)} aria-invalid={fieldErrors.away ? true : undefined} aria-describedby={fieldErrors.away ? `${id}-away-error` : `${id}-away-hint`} />
            </div>
          </div>
          {fieldErrors.away && <p id={`${id}-away-error`} className="form-field__error">{fieldErrors.away}</p>}
        </fieldset>


        <div className="profile-actions">
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-presence`}>My status</label>
            <select id={`${id}-presence`} className="form-input" value={ownStatus} onChange={(e) => onStatusChange(e.target.value as OwnPresence)}>
              <option value="ONLINE">Online</option>
              <option value="BUSY">Busy</option>
            </select>
          </div>
          <button type="submit" className="button-primary" disabled={saving || uploading}>
            {saving && <span className="spinner" aria-hidden="true" />}
            <span>{saving ? "Saving…" : "Save profile"}</span>
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export default ProfileForm;
