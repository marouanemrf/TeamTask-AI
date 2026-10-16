import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { Announcements, CollisionDetection, DragEndEvent, DragStartEvent, KeyboardCoordinateGetter } from "@dnd-kit/core";
import type { Dependency, Task, TaskEvent, TaskStatus, TeamMember } from "../../services/client";
import { BOARD_COLUMNS, TASK_STATUS_LABELS } from "../../utils/projectLabels";
import { blockReasonFor, isOverdue, unfinishedDependencies } from "../../utils/taskRules";
import { ChevronDownIcon } from "../ui/Icons";
import TaskCard, { TaskCardView } from "./TaskCard";

const COLUMN_PREFIX = "column:";

export interface KanbanBoardProps {
  tasks: Task[];
  dependencies: readonly Dependency[];
  tasksById: ReadonlyMap<string, Task>;
  membersById: ReadonlyMap<string, TeamMember>;
  /** Latest STATUS_CHANGED event per task (for blocker reasons). */
  statusEvents: ReadonlyMap<string, TaskEvent>;
  today: string;
  canMove: (task: Task) => boolean;
  /** Called on drop in another column. The page checks the dependency rule and saves. */
  onMove: (task: Task, status: TaskStatus) => void;
  onOpen: (task: Task) => void;
}

/** Pointer first (precise under the cursor), then rectangle overlap (keyboard drags have no pointer). */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

/** Arrow keys jump between columns instead of moving by a few pixels. */
const columnCoordinates: KeyboardCoordinateGetter = (event, { context: { droppableRects, droppableContainers, collisionRect } }) => {
  if (!collisionRect || !["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.code)) return undefined;
  event.preventDefault();
  const columns = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.left - b.left);
  if (columns.length === 0) return undefined;

  const centerX = collisionRect.left + collisionRect.width / 2;
  let index = columns.findIndex((r) => centerX >= r.left && centerX <= r.left + r.width);
  if (index === -1) index = columns.findIndex((r) => r.left > centerX) - 1;
  if (event.code === "ArrowRight") index = Math.min(index + 1, columns.length - 1);
  if (event.code === "ArrowLeft") index = Math.max(index - 1, 0);
  index = Math.max(0, index); // Up/Down: drop into the column under the card

  const target = columns[index];
  return { x: target.left + (target.width - collisionRect.width) / 2, y: target.top + 48 };
};

const statusOf = (id: string | number | undefined) =>
  typeof id === "string" && id.startsWith(COLUMN_PREFIX) ? (id.slice(COLUMN_PREFIX.length) as TaskStatus) : null;

function Column({ status, children, count }: { status: TaskStatus; children: ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${status}` });
  const headingId = `kanban-${status}`;
  return (
    <section ref={setNodeRef} className={`kanban__column${isOver ? " kanban__column--over" : ""}`} aria-labelledby={headingId}>
      <h3 id={headingId} className="kanban__title">
        <span className={`kanban__dot kanban__dot--${status.toLowerCase()}`} aria-hidden="true" />
        {TASK_STATUS_LABELS[status]}
        <span className="kanban__count">{count}</span>
      </h3>
      <div className="kanban__list">{children}</div>
    </section>
  );
}

/** Kanban: TODO / IN_PROGRESS / BLOCKED / DONE, with PROPOSED tasks in a collapsible row above. */
function KanbanBoard({ tasks, dependencies, tasksById, membersById, statusEvents, today, canMove, onMove, onOpen }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showProposals, setShowProposals] = useState(true);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // small move = drag, click = open
    useSensor(KeyboardSensor, {
      coordinateGetter: columnCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  const byStatus = useMemo(() => {
    const groups = new Map<TaskStatus, Task[]>();
    for (const task of tasks) {
      const status = task.status ?? "TODO";
      groups.set(status, [...(groups.get(status) ?? []), task]);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || a.title.localeCompare(b.title));
    }
    return groups;
  }, [tasks]);

  const proposals = byStatus.get("PROPOSED") ?? [];
  const active = activeId ? tasksById.get(activeId) : undefined;

  const viewProps = (task: Task) => ({
    task,
    assignee: task.assigneeId ? membersById.get(task.assigneeId) : undefined,
    overdue: isOverdue(task, today),
    blockedBy: unfinishedDependencies(task.id, dependencies, tasksById).length,
    block: blockReasonFor(task, statusEvents.get(task.id)),
  });

  const card = (task: Task) => <TaskCard key={task.id} {...viewProps(task)} movable={canMove(task)} onOpen={onOpen} />;

  const titleOf = (id: string | number) => tasksById.get(String(id))?.title ?? "task";
  const columnLabel = (id: string | number | undefined) => {
    const status = statusOf(id);
    return status ? TASK_STATUS_LABELS[status] : null;
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up task ${titleOf(a.id)}.`,
    onDragOver: ({ active: a, over }) =>
      over ? `Task ${titleOf(a.id)} is over the ${columnLabel(over.id)} column.` : `Task ${titleOf(a.id)} is not over a column.`,
    onDragEnd: ({ active: a, over }) =>
      over ? `Task ${titleOf(a.id)} was dropped in ${columnLabel(over.id)}.` : `Task ${titleOf(a.id)} was dropped. No change.`,
    onDragCancel: ({ active: a }) => `Moving cancelled. Task ${titleOf(a.id)} was not moved.`,
  };

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const task = tasksById.get(String(event.active.id));
    const status = statusOf(event.over?.id);
    if (task && status && status !== task.status) onMove(task, status);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To move a task, press Space to pick it up, use the left and right arrow keys to choose a column, then press Space to drop it. Press Escape to cancel. Press Enter to open the task.",
        },
      }}
    >
      {proposals.length > 0 && (
        <section className="proposals" aria-labelledby="proposals-title">
          <h3 id="proposals-title" className="proposals__heading">
            <button
              type="button"
              className="proposals__toggle"
              aria-expanded={showProposals}
              aria-controls="proposals-list"
              onClick={() => setShowProposals((v) => !v)}
            >
              <ChevronDownIcon />
              Proposals <span className="kanban__count">{proposals.length}</span>
            </button>
          </h3>
          {showProposals && (
            <div id="proposals-list" className="proposals__list">
              {proposals.map(card)}
            </div>
          )}
        </section>
      )}

      <div className="kanban" role="group" aria-label="Kanban board">
        {BOARD_COLUMNS.map((status) => {
          const list = byStatus.get(status) ?? [];
          return (
            <Column key={status} status={status} count={list.length}>
              {list.length ? list.map(card) : <p className="kanban__empty">No tasks</p>}
            </Column>
          );
        })}
      </div>

      <DragOverlay>{active ? <div className="task-card task-card--overlay"><TaskCardView {...viewProps(active)} /></div> : null}</DragOverlay>
    </DndContext>
  );
}

export default KanbanBoard;
