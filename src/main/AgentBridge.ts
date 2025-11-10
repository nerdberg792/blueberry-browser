import { WebContents } from "electron";
import { AgentServer } from "../agent-server/server";
import {
  AgentRuntime,
  AgentTask,
  AgentTaskContext,
} from "../agent-server";
import type { AgentExecutor } from "../agent-server/types";
import type { Window } from "./Window";

const IPC_CHANNEL = "agent:event";

export interface AgentBridgeOptions {
  runtimeConfig?: Parameters<typeof AgentRuntime>[0];
}

export class AgentBridge {
  private readonly server: AgentServer;
  private readonly runtime: AgentRuntime;
  private readonly window: Window;
  private readonly subscribers = new Set<WebContents>();
  private port: number | null = null;
  private started = false;

  constructor(window: Window, opts?: AgentBridgeOptions) {
    this.window = window;
    this.server = new AgentServer({
      runtimeConfig: { maxParallelTasks: 1, ...(opts?.runtimeConfig ?? {}) },
    });
    this.runtime = this.server.getRuntime();
    this.forwardRuntimeEvents();
  }

  async start(): Promise<number> {
    if (this.started) {
      return this.port ?? 0;
    }
    this.port = await this.server.start();
    this.started = true;
    return this.port;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    await this.server.stop();
    this.started = false;
    this.port = null;
  }

  get listeningPort(): number | null {
    return this.port;
  }

  registerExecutor(executor: AgentExecutor): void {
    this.runtime.registerExecutor(executor);
  }

  async createTask(goal: string, context?: AgentTaskContext): Promise<AgentTask> {
    const task = await this.runtime.createTask(goal, context);
    return task;
  }

  listTasks(): AgentTask[] {
    return this.runtime.listTasks();
  }

  getTask(taskId: string): AgentTask | undefined {
    return this.runtime.getTask(taskId);
  }

  getTools() {
    return this.runtime.getTools();
  }

  subscribe(webContents: WebContents): void {
    this.subscribers.add(webContents);
    webContents.once("destroyed", () => {
      this.subscribers.delete(webContents);
    });
    webContents.send(IPC_CHANNEL, {
      type: "snapshot",
      payload: {
        tasks: this.runtime.listTasks(),
        tools: this.runtime.getTools(),
        port: this.port,
      },
    });
  }

  private forwardRuntimeEvents(): void {
    const forward = (type: string) => (payload: unknown) =>
      this.dispatch({ type, payload });
    this.runtime.on("task-created", forward("task-created"));
    this.runtime.on("task-started", forward("task-started"));
    this.runtime.on("step-created", forward("step-created"));
    this.runtime.on("step-updated", forward("step-updated"));
    this.runtime.on("task-completed", forward("task-completed"));
    this.runtime.on("task-failed", forward("task-failed"));
    this.runtime.on("task-error", forward("task-error"));
    this.runtime.on("planning-started", forward("planning-started"));
    this.runtime.on("planning-finished", forward("planning-finished"));
  }

  private dispatch(message: unknown): void {
    for (const webContents of this.subscribers) {
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_CHANNEL, message);
      }
    }
  }
}


