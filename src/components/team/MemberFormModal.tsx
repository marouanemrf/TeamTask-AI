import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { TeamMember, TeamRole } from "../../services/client";
import { KEEP_AVATAR } from "../../services/teamService";
import type { AvatarChange, MemberInput } from "../../services/teamService";
import {
  AVATAR_ACCEPT,
  toSquareAvatar,
  validateImageFile,
} from "../../utils/image";
import { ROLES, ROLE_LABELS } from "../../utils/roles";
import {
  normalizeEmail,
  normalizeUsername,
  suggestUsername,
  validateUsername,
} from "../../utils/text";
import MemberAvatar from "./MemberAvatar";
import SkillsInput from "./SkillsInput";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 60;

type FieldErrors = Partial<
  Record<"name" | "email" | "username" | "capacity", string>
>;
type Values = {
  name: string;
  email: string;
  username: string;
  capacity: string;
};

export interface MemberFormModalProps {
  /** Member to edit; omit to create. */
  member?: TeamMember;
  /** Emails already used in the organisation (for instant duplicate feedback; the service re-checks). */
  existingEmails: readonly string[];
  /** Usernames already used in the organisation (same purpose). */
  existingUsernames: readonly string[];
  submitting: boolean;
  /** API error, already a user-facing message. */
  error: string | null;
  /** Resolves to true when saved (the modal then closes). */
  onSubmit: (input: MemberInput, avatar: AvatarChange) => Promise<boolean>;
  onClose: () => void;
  canGrantPrivileged?: boolean;
}

/** Create / edit a team member in a native modal <dialog> (focus trap + Escape built in). */
function MemberFormModal({
  member,
  existingEmails,
  existingUsernames,
  submitting,
  error,
  onSubmit,
  onClose,
  canGrantPrivileged = false,
}: MemberFormModalProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const capacityRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  // Pre-filled from the email until the user edits it.
  const [username, setUsername] = useState(
    member?.username ?? (member ? suggestUsername(member.email) : ""),
  );
  const [usernameTouched, setUsernameTouched] = useState(!!member?.username);
  const [avatar, setAvatar] = useState<AvatarChange>(KEEP_AVATAR);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [jobTitle, setJobTitle] = useState(member?.jobTitle ?? "");
  const [roles, setRoles] = useState<TeamRole[]>(() => member?.roles?.filter((role): role is TeamRole => !!role && (ROLES as readonly string[]).includes(role)) ?? [member?.role ?? "MEMBER"]);
  const [skills, setSkills] = useState<string[]>(
    (member?.skills ?? []).filter((s): s is string => !!s),
  );
  const [capacity, setCapacity] = useState(
    String(member?.weeklyCapacityHours ?? 40),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);

  // Open as a modal on mount; give focus back to the opener when it goes away.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.showModal();
    nameRef.current?.focus();
    return () => opener?.focus();
  }, []);

  // Free the local preview when it is replaced or the modal closes.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function validate(
    values: Values = { name, email, username, capacity },
  ): FieldErrors {
    const next: FieldErrors = {};
    if (!values.name.trim()) next.name = "Full name is required.";
    const normalized = normalizeEmail(values.email);
    if (!normalized) next.email = "Email is required.";
    else if (!EMAIL_PATTERN.test(normalized))
      next.email = "Enter a valid email address.";
    else if (
      existingEmails.some((e) => normalizeEmail(e) === normalized) &&
      normalized !== normalizeEmail(member?.email ?? "")
    ) {
      next.email =
        "A member with this email already exists in the organisation.";
    }
    const usernameError = validateUsername(values.username);
    const normalizedUsername = normalizeUsername(values.username);
    if (usernameError) next.username = usernameError;
    else if (
      existingUsernames.some(
        (u) => normalizeUsername(u) === normalizedUsername,
      ) &&
      normalizedUsername !== normalizeUsername(member?.username ?? "")
    ) {
      next.username = "This username is already taken in the organisation.";
    }
    const hours = Number(values.capacity);
    if (
      !Number.isInteger(hours) ||
      hours < MIN_CAPACITY ||
      hours > MAX_CAPACITY
    ) {
      next.capacity = `Enter a whole number of hours between ${MIN_CAPACITY} and ${MAX_CAPACITY}.`;
    }
    return next;
  }

  // After a first submit, keep errors in sync as the user fixes the fields.
  function revalidate(changes: Partial<Values>) {
    if (submitted)
      setErrors(validate({ name, email, username, capacity, ...changes }));
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    const nextUsername = usernameTouched ? username : suggestUsername(value);
    if (!usernameTouched) setUsername(nextUsername);
    revalidate({ email: value, username: nextUsername });
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow choosing the same file again
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) {
      setPhotoError(problem);
      return;
    }
    setPhotoError(null);
    setProcessingPhoto(true);
    try {
      const image = await toSquareAvatar(file);
      setAvatar({ kind: "replace", image });
      setPreviewUrl(URL.createObjectURL(image));
    } catch (err) {
      console.error("[MemberFormModal] Image processing failed", err);
      setPhotoError("This image could not be read. Try another file.");
    } finally {
      setProcessingPhoto(false);
    }
  }

  function handleRemovePhoto() {
    setAvatar(member?.avatarKey ? { kind: "remove" } : KEEP_AVATAR);
    setPreviewUrl(null);
    setPhotoError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitted(true);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (roles.length === 0) return;
    if (nextErrors.name) return nameRef.current?.focus();
    if (nextErrors.email) return emailRef.current?.focus();
    if (nextErrors.username) return usernameRef.current?.focus();
    if (nextErrors.capacity) return capacityRef.current?.focus();

    const input: MemberInput = {
      name: name.trim(),
      email: email.trim(),
      username: normalizeUsername(username),
      jobTitle: jobTitle.trim(),
      roles,
      skills,
      weeklyCapacityHours: Number(capacity),
    };
    const saved = await onSubmit(input, avatar);
    if (saved) onClose();
  }

  const invalid = (field: keyof FieldErrors) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${id}-${field}-error` : undefined,
  });
  const fieldError = (field: keyof FieldErrors) =>
    errors[field] && (
      <p id={`${id}-${field}-error`} className="form-field__error">
        {errors[field]}
      </p>
    );
  const hasPhoto =
    !!previewUrl || (avatar.kind === "keep" && !!member?.avatarKey);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault(); // Escape: close through React state, never mid-save
        if (!submitting) onClose();
      }}
    >
      <form
        className="modal__form"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={submitting}
      >
        <header className="modal__header">
          <h2 id={`${id}-title`} className="modal__title">
            {member ? "Edit member" : "Add a member"}
          </h2>
          <p className="modal__info">
            {member ? "Update team access and profile details." : "An individual sign-in account will be created and an invitation sent to this email."}
          </p>
        </header>

        {/* Scroll wrapper: a <fieldset> cannot shrink inside a flex column, so it doesn't scroll itself. */}
        <div className="modal__scroll">
          <fieldset className="modal__body" disabled={submitting}>
            <legend className="visually-hidden">Member details</legend>
            {roles.length === 0 && <p className="form-field__error" role="alert">Select at least one role.</p>}

            <div className="photo-field">
              <MemberAvatar
                name={name || "?"}
                avatarKey={avatar.kind === "keep" ? member?.avatarKey : null}
                previewUrl={previewUrl}
                size="lg"
              />
              <div className="photo-field__controls">
                <span className="form-field__label" id={`${id}-photo-label`}>
                  Profile picture
                </span>
                <div className="photo-field__buttons">
                  <input
                    id={`${id}-photo`}
                    className="visually-hidden file-input"
                    type="file"
                    accept={AVATAR_ACCEPT}
                    onChange={(e) => void handlePhotoChange(e)}
                    aria-labelledby={`${id}-photo-label ${id}-photo-button`}
                    aria-describedby={
                      photoError ? `${id}-photo-error` : `${id}-photo-hint`
                    }
                  />
                  <label
                    id={`${id}-photo-button`}
                    htmlFor={`${id}-photo`}
                    className="button-secondary"
                  >
                    {processingPhoto
                      ? "Processing…"
                      : hasPhoto
                        ? "Change photo"
                        : "Upload photo"}
                  </label>
                  {hasPhoto && (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={handleRemovePhoto}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {photoError ? (
                  <p
                    id={`${id}-photo-error`}
                    className="form-field__error"
                    role="alert"
                  >
                    {photoError}
                  </p>
                ) : (
                  <p id={`${id}-photo-hint`} className="form-hint">
                    JPG, PNG, WebP or GIF, up to 5 MB. Cropped to a square.
                  </p>
                )}
              </div>
            </div>

            <div className="form-field">
              <label className="form-field__label" htmlFor={`${id}-name`}>
                Full name <span aria-hidden="true">*</span>
              </label>
              <input
                ref={nameRef}
                id={`${id}-name`}
                className="form-input"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  revalidate({ name: e.target.value });
                }}
                {...invalid("name")}
              />
              {fieldError("name")}
            </div>

            <div className="form-field">
              <label className="form-field__label" htmlFor={`${id}-email`}>
                Email <span aria-hidden="true">*</span>
              </label>
              <input
                ref={emailRef}
                id={`${id}-email`}
                className="form-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                {...invalid("email")}
              />
              {fieldError("email")}
            </div>

            <div className="form-field">
              <label className="form-field__label" htmlFor={`${id}-username`}>
                Username <span aria-hidden="true">*</span>
              </label>
              <div className="input-prefix">
                <span className="input-prefix__symbol" aria-hidden="true">
                  @
                </span>
                <input
                  ref={usernameRef}
                  id={`${id}-username`}
                  className="form-input"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={username}
                  onChange={(e) => {
                    const value = normalizeUsername(e.target.value);
                    setUsername(value);
                    setUsernameTouched(true);
                    revalidate({ username: value });
                  }}
                  aria-invalid={errors.username ? true : undefined}
                  aria-describedby={
                    errors.username
                      ? `${id}-username-error`
                      : `${id}-username-hint`
                  }
                />
              </div>
              {errors.username ? (
                <p id={`${id}-username-error`} className="form-field__error">
                  {errors.username}
                </p>
              ) : (
                <p id={`${id}-username-hint`} className="form-hint">
                  Unique in the organisation. Lowercase letters, numbers, dots,
                  dashes or underscores.
                </p>
              )}
            </div>

            <div className="modal__row">
              <div className="form-field">
                <label className="form-field__label" htmlFor={`${id}-job`}>
                  Job title
                </label>
                <input
                  id={`${id}-job`}
                  className="form-input"
                  placeholder="e.g. Security Analyst"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>
              <div className="form-field">
                <span className="form-field__label">Roles (select one or more)</span>
                <div className="role-options">
                  {ROLES.filter((r) => canGrantPrivileged || !["ADMIN", "PROJECT_MANAGER"].includes(r)).map((r) => (
                    <label key={r} className="checkbox-label"><input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles((current) => e.target.checked ? [...current, r] : current.filter((role) => role !== r))} />{ROLE_LABELS[r]}</label>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-field">
              <label className="form-field__label" htmlFor={`${id}-skill`}>
                Skills
              </label>
              <SkillsInput id={`${id}-skill`} skills={skills} onChange={setSkills} />
            </div>

            <div className="form-field">
              <label className="form-field__label" htmlFor={`${id}-capacity`}>
                Weekly capacity (hours)
              </label>
              <input
                ref={capacityRef}
                id={`${id}-capacity`}
                className="form-input form-input--narrow"
                type="number"
                inputMode="numeric"
                min={MIN_CAPACITY}
                max={MAX_CAPACITY}
                step={1}
                value={capacity}
                onChange={(e) => {
                  setCapacity(e.target.value);
                  revalidate({ capacity: e.target.value });
                }}
                {...invalid("capacity")}
              />
              {fieldError("capacity")}
            </div>

            {error && (
              <div className="form-alert" role="alert">
                <span>{error}</span>
              </div>
            )}
          </fieldset>
        </div>

        <footer className="modal__footer">
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button-primary button-primary--inline"
            disabled={submitting || processingPhoto}
          >
            {submitting && <span className="spinner" aria-hidden="true" />}
            <span>
              {submitting ? "Saving…" : member ? "Save changes" : "Add member"}
            </span>
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export default MemberFormModal;
