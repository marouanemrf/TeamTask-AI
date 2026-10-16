import "./amplifyConfig";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

/**
 * The app's single Data client. Only files in src/services may import it;
 * pages and components go through hooks, which call services.
 */
export const client = generateClient<Schema>();

// Model types shared by services, hooks and components.
export type Organisation = Schema["Organisation"]["type"];
export type Project = Schema["Project"]["type"];
export type ProjectStatus = NonNullable<Project["status"]>;
export type Task = Schema["Task"]["type"];
export type TaskStatus = NonNullable<Task["status"]>;
export type TaskPriority = NonNullable<Task["priority"]>;
export type Milestone = Schema["Milestone"]["type"];
export type Dependency = Schema["Dependency"]["type"];
export type TaskEvent = Schema["TaskEvent"]["type"];
export type TeamMember = Schema["TeamMember"]["type"];
export type Reminder = Schema["Reminder"]["type"];
export type Escalation = Schema["Escalation"]["type"];
export type WeeklyReport = Schema["WeeklyReport"]["type"];
export type TeamRole = NonNullable<TeamMember["role"]>;
export type MemberRoles = NonNullable<TeamMember["roles"]>;
export type TaskEventType = NonNullable<Schema["TaskEvent"]["type"]["eventType"]>;
export type ActorType = NonNullable<Schema["TaskEvent"]["type"]["actorType"]>;
