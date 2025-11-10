import { IncomingMessage, ServerResponse } from "http";

export type AgentTaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface AgentTaskContext {
  url?: string;
  pageTitle?: string;
  pageDescription?: string;
  startingHtmlExcerpt?: string;
}

export interface AgentTask {
  id: string;
  goal: string;
  status: AgentTaskStatus;
  createdAt: number;
  updatedAt: number;
  steps: AgentStep[];
  summary?: string;
  context?: AgentTaskContext;
  lastError?: string;
}

export type AgentStepStatus = "pending" | "running" | "succeeded" | "failed";

export interface AgentStep {
  id: string;
  index: number;
  status: AgentStepStatus;
  createdAt: number;
  updatedAt: number;
  action?: AgentAction;
  observation?: AgentObservation;
  modelThought?: string;
}

export type AgentActionType =
  | "navigate"
  | "click"
  | "type"
  | "wait"
  | "scroll"
  | "extract"
  | "finish";

export interface AgentAction {
  type: AgentActionType;
  params: Record<string, unknown>;
}

export interface AgentObservation {
  result: "success" | "error";
  message: string;
  data?: Record<string, unknown>;
}

export interface AgentPlanOutput {
  thought: string;
  action?: AgentAction;
  finish?: {
    status: "success" | "failed";
    summary: string;
  };
  caution?: string;
}

export interface ActionExecutionResult {
  observation: AgentObservation;
  didTerminate?: boolean;
  summary?: string;
}

export type AgentExecutor = (payload: {
  task: AgentTask;
  step: AgentStep;
  action: AgentAction;
}) => Promise<ActionExecutionResult>;

export interface RuntimeConfig {
  maxSteps?: number;
  maxParallelTasks?: number;
  maxWaitMs?: number;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  schema: Record<string, { description: string; required?: boolean }>;
  execution: {
    invokesExecutor: boolean;
    expectedLatencyMs: number;
  };
  safetyNotes?: string[];
}

export type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;


