import { useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Dependency, Project, Task, TaskPriority, TeamMember } from "../../services/client";
import type { TaskInput } from "../../services/taskService";
import { PRIORITY_LABELS, TASK_PRIORITIES } from "../../utils/projectLabels";
import { dependsOnIds, descendantIds, dueDateWarning, rankAssignees, wouldCreateCycle } from "../../utils/taskRules";
import SkillsInput from "../team/SkillsInput";
import Modal from "../ui/Modal";

export interface TaskFormModalProps {
  project: Project;
  /** Task to edit; omit to create. */
  task?: Task;
  projectTasks: readonly Task[];
  dependencies: readonly Dependency[];
  members: readonly TeamMember[];
  /** Every readable task, for workload percentages. */
  allTasks: readonly Task[];
  submitting: boolean;
  error: string | null;
  /** Resolves to true when saved (the modal then closes). */
  onSubmit: (input: TaskInput, dependsOn: string[]) => Promise<boolean>;
  onClose: () => void;
}

type FieldErrors = Partial<Record<"title" | "hours" | "assignee" | "dependsOn", string>>;

/** Create / edit a task (managers). */
function TaskFormModal({ project, task, projectTasks, dependencies, members, allTasks, submitting, error, onSubmit, onClose }: TaskFormModalProps) {
  const id = useId();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "MEDIUM");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [hours, setHours] = useState(task?.estimatedHours != null ? String(task.estimatedHours) : "");
  const [skills, setSkills] = useState<string[]>((task?.requiredSkills ?? []).filter((s): s is string => !!s));
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? "");
  const [parentTaskId, setParentTaskId] = useState(task?.parentTaskId ?? "");
  const [dependsOn, setDependsOn] = useState<string[]>(task ? dependsOnIds(task.id, dependencies) : []);
  const [errors, setErrors] = useState<FieldErrors>({});

  const hoursValue = hours.trim() === "" ? 0 : Number(hours);
  const others = useMemo(
    () => projectTasks.filter((t) => t.id !== task?.id).sort((a, b) => a.title.localeCompare(b.title)),
    [projectTasks, task?.id],
  );

  // Assignee options: best skill match first, then lightest workload.
  const ranked = useMemo(
    () => rankAssignees(members, allTasks, skills, Number.isFinite(hoursValue) ? hoursValue : 0, task?.id),
    [members, allTasks, skills, hoursValue, task?.id],
  );
  const selected = ranked.find((o) => o.member.id === assigneeId);
  const overload = selected && selected.projectedPercent > 100 ? selected : undefined;

  // A subtask can't become its own parent (directly or through its subtasks).
  const forbiddenParents = useMemo(() => (task ? descendantIds(task.id, projectTasks) : new Set<string>()), [task, projectTasks]);
  // Options that would create a cycle on their own are disabled.
  const cyclic = useMemo(
    () => new Set(task ? others.filter((o) => wouldCreateCycle(task.id, [o.id], dependencies)).map((o) => o.id) : []),
    [task, others, dependencies],
  );

  const dateWarning = dueDateWarning(dueDate, project.startDate, project.endDate);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!title.trim()) next.title = "Title is required.";
    if (hours.trim() !== "" && (!Number.isFinite(hoursValue) || hoursValue < 0 || hoursValue > 1000)) {
      next.hours = "Enter a number of hours between 0 and 1000.";
    }
    // Every task belongs to this project and is assigned to someone who can work on it.
    if (!ranked.some((o) => o.member.id === assigneeId)) next.assignee = "Choose the team member this task is assigned to.";
    if (task && wouldCreateCycle(task.id, dependsOn, dependencies)) {
      next.dependsOn = "These dependencies would create a circular dependency.";
    }
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    const firstInvalid = (["title", "hours", "assignee", "dependsOn"] as const).find((f) => nextErrors[f]);
    if (firstInvalid) {
      document.getElementById(`${id}-${firstInvalid}`)?.focus();
      return;
    }
    const saved = await onSubmit(
      {
        projectId: project.id,
        title: title.trim(),
        description: description.trim(),
        priority,
        dueDate,
        estimatedHours: hours.trim() === "" ? undefined : hoursValue,
        requiredSkills: skills,
        assigneeId,
        parentTaskId,
      },
      dependsOn,
    );
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

  const assigneeLabel = (o: (typeof ranked)[number]) => {
    const match = skills.length ? `${o.matches}/${skills.length} skills · ` : "";
    return `${o.member.name} — ${match}${o.workloadPercent}% load`;
  };

  return (
    <Modal
      title={task ? "Edit task" : "New task"}
      onClose={onClose}
      busy={submitting}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="button-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="button-primary button-primary--inline" disabled={submitting}>
            {submitting && <span className="spinner" aria-hidden="true" />}
            <span>{submitting ? "Saving…" : task ? "Save changes" : "Create task"}</span>
          </button>
        </>
      }
    >
      <fieldset className="modal__fields" disabled={submitting}>
        <legend className="visually-hidden">Task details</legend>

        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-project`}>Project</label>
          <input id={`${id}-project`} className="form-input form-input--locked" value={project.name} disabled readOnly />
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-title`}>
            Title <span aria-hidden="true">*</span>
          </label>
          <input id={`${id}-title`} className="form-input" required value={title} onChange={(e) => setTitle(e.target.value)} {...invalid("title")} />
          {fieldError("title")}
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-description`}>
            Description
          </label>
          <textarea id={`${id}-description`} className="form-input form-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="modal__row">
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-priority`}>
              Priority
            </label>
            <select id={`${id}-priority`} className="form-input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label className="form-field__label" htmlFor={`${id}-hours`}>
              Estimated hours
            </label>
            <input
              id={`${id}-hours`}
              className="form-input"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              {...invalid("hours")}
            />
            {fieldError("hours")}
          </div>
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-due`}>
            Due date
          </label>
          <input
            id={`${id}-due`}
            className="form-input form-input--date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-describedby={dateWarning ? `${id}-due-warning` : undefined}
          />
          {dateWarning && (
            <p id={`${id}-due-warning`} className="form-warning">
              {dateWarning}
            </p>
          )}
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-skill`}>
            Required skills
          </label>
          <SkillsInput id={`${id}-skill`} skills={skills} onChange={setSkills} />
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-assignee`}>
            Assigned to <span aria-hidden="true">*</span>
          </label>
          <select
            id={`${id}-assignee`}
            className="form-input"
            value={selected ? assigneeId : ""}
            onChange={(e) => {
              setAssigneeId(e.target.value);
              if (errors.assignee) setErrors((current) => ({ ...current, assignee: undefined }));
            }}
            required
            aria-invalid={errors.assignee ? true : undefined}
            aria-describedby={`${id}-assignee-hint${errors.assignee ? ` ${id}-assignee-error` : ""}${overload ? ` ${id}-assignee-warning` : ""}`}
          >
            <option value="" disabled>
              Select a team member
            </option>
            {ranked.map((o) => (
              <option key={o.member.id} value={o.member.id}>
                {assigneeLabel(o)}
              </option>
            ))}
          </select>
          <p id={`${id}-assignee-hint`} className="form-hint">
            Sorted by matching skills, then current workload. Read-only (viewer) accounts can't hold tasks.
          </p>
          {fieldError("assignee")}
          {overload && (
            <p id={`${id}-assignee-warning`} className="form-warning">
              This task would bring {overload.member.name} to {overload.projectedPercent}% of their weekly capacity.
            </p>
          )}
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor={`${id}-parent`}>
            Parent task
          </label>
          <select id={`${id}-parent`} className="form-input" value={parentTaskId} onChange={(e) => setParentTaskId(e.target.value)}>
            <option value="">None</option>
            {others
              .filter((t) => !forbiddenParents.has(t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </div>

        <fieldset className="form-field checklist" id={`${id}-dependsOn`} tabIndex={-1} {...invalid("dependsOn")}>
          <legend className="form-field__label">Depends on</legend>
          {others.length === 0 ? (
            <p className="form-hint">No other tasks in this project yet.</p>
          ) : (
            <ul className="checklist__items">
              {others.map((t) => {
                const disabled = cyclic.has(t.id) && !dependsOn.includes(t.id);
                return (
                  <li key={t.id}>
                    <label className={`checklist__item${disabled ? " checklist__item--disabled" : ""}`}>
                      <input
                        type="checkbox"
                        checked={dependsOn.includes(t.id)}
                        disabled={disabled}
                        onChange={(e) =>
                          setDependsOn((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))
                        }
                      />
                      <span>{t.title}</span>
                      {disabled && <span className="checklist__note">would create a circular dependency</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {fieldError("dependsOn")}
        </fieldset>

        {error && (
          <div className="form-alert" role="alert">
            <span>{error}</span>
          </div>
        )}
      </fieldset>
    </Modal>
  );
}

export default TaskFormModal;
