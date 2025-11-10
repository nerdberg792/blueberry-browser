import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { AgentMemory } from "./AgentMemory";
import { AgentModelClient } from "./AgentModelClient";
import { AgentOrchestrator } from "./AgentOrchestrator";
import { toolRegistry } from "./ToolRegistry";
import {
  AgentExecutor,
  AgentTask,
  AgentTaskContext,
  RuntimeConfig,
} from "./types";
import { agentSafetyConfig } from "../main/guardrails/config";

interface TaskQueueItem {
  task: AgentTask;
  resolve: () => void;
  reject: (error: Error) => void;
}

const DEFAULT_EXECUTOR: AgentExecutor = async () => ({
  observation: {
    result: "error",
    message:
      "Agent executor not connected. Please register an executor bridge.",
  },
  didTerminate: true,
  summary: "Stopped because no executor bridge is available.",
});

export class AgentRuntime extends EventEmitter {
  private readonly memory = new AgentMemory();
  private readonly modelClient = new AgentModelClient();
  private executor: AgentExecutor = DEFAULT_EXECUTOR;
  private readonly config: RuntimeConfig;
  private readonly orchestrator: AgentOrchestrator;
  private readonly tasks = new Map<string, AgentTask>();
  private readonly queue: TaskQueueItem[] = [];
  private readonly activeTaskIds = new Set<string>();

  constructor(config?: RuntimeConfig) {
    super();
    this.config = {
      maxSteps: agentSafetyConfig.maxSteps,
      maxParallelTasks: agentSafetyConfig.maxParallelTasks,
      maxWaitMs: agentSafetyConfig.maxWaitMs,
      ...(config ?? {}),
    };
    this.orchestrator = new AgentOrchestrator({
      memory: this.memory,
      modelClient: this.modelClient,
      executor: (payload) => this.executor(payload),
      emitter: this,
      config: this.config,
    });
  }

  registerExecutor(executor: AgentExecutor): void {
    this.executor = executor;
  }

  async createTask(goal: string, context?: AgentTaskContext): Promise<AgentTask> {
    if (!goal || goal.trim().length === 0) {
      throw new Error("Goal is required to create a task.");
    }
    if (!this.modelClient.isReady) {
      throw new Error(
        "Agent model is not initialised. Configure the AGENT_MODEL/API key first."
      );
    }
    const task: AgentTask = {
      id: randomUUID(),
      goal,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [],
      context,
    };
    this.tasks.set(task.id, task);
    this.emit("task-created", { task });
    await this.enqueue(task);
    return task;
  }

  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(): AgentTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  updateTaskContext(taskId: string, patch: Partial<AgentTaskContext>): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }
    task.context = { ...(task.context ?? {}), ...patch };
    task.updatedAt = Date.now();
    this.emit("task-updated", { taskId, task });
  }

  getTools() {
    return toolRegistry.getTools();
  }

  private async enqueue(task: AgentTask): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    const limit = this.config.maxParallelTasks ?? 1;
    while (this.activeTaskIds.size < limit && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;
      const { task, resolve, reject } = item;
      this.activeTaskIds.add(task.id);
      this.runTask(task)
        .then(() => {
          this.activeTaskIds.delete(task.id);
          resolve();
          this.drainQueue();
        })
        .catch((error) => {
          this.activeTaskIds.delete(task.id);
          reject(error instanceof Error ? error : new Error(String(error)));
          this.drainQueue();
        });
    }
  }

  private async runTask(task: AgentTask): Promise<void> {
    try {
      await this.orchestrator.run(task);
    } catch (error) {
      task.status = "failed";
      task.updatedAt = Date.now();
      task.lastError =
        error instanceof Error ? error.message : "Unknown orchestrator error.";
      this.emit("task-failed", { taskId: task.id, error: task.lastError });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}


