// Leaf re-export so workload.ts can use the shared rule without importing taskRules.ts (avoids a cycle).
export { isOpenTask } from "../../amplify/functions/shared/rules";
