import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import {
  ActionExecutionResult,
  AgentAction,
  AgentObservation,
  AgentPlanOutput,
  AgentStep,
  AgentTask,
  AgentTaskStatus,
  AgentExecutor,
  RuntimeConfig,
} from "./types";
import { AgentMemory } from "./AgentMemory";
import { AgentModelClient } from "./AgentModelClient";
import { toolRegistry } from "./ToolRegistry";
import { agentSafetyConfig } from "../main/guardrails/config";

export interface OrchestratorDependencies {
  memory: AgentMemory;
  modelClient: AgentModelClient;
  executor: AgentExecutor;
  emitter: EventEmitter;
  config?: RuntimeConfig;
}

const DEFAULT_MAX_STEPS = agentSafetyConfig.maxSteps;

export class AgentOrchestrator {
  private readonly memory: AgentMemory;
  private readonly modelClient: AgentModelClient;
  private readonly executor: AgentExecutor;
  private readonly emitter: EventEmitter;
  private readonly config: RuntimeConfig;

  constructor(deps: OrchestratorDependencies) {
    this.memory = deps.memory;
    this.modelClient = deps.modelClient;
    this.executor = deps.executor;
    this.emitter = deps.emitter;
    this.config = deps.config ?? {};
  }

  async run(task: AgentTask): Promise<void> {
    task.status = "running";
    this.emit("task-started", { taskId: task.id });

    const maxSteps = this.config.maxSteps ?? DEFAULT_MAX_STEPS;
    for (let iteration = 0; iteration < maxSteps; iteration++) {
      try {
        const plan = await this.planStep(task);

        if (plan.caution) {
          this.memory.remember(task.id, {
            type: "thought",
            content: `Safety note: ${plan.caution}`,
            timestamp: Date.now(),
          });
        }

        if (plan.finish) {
          await this.completeFromFinish(task, plan.finish.summary, plan.finish);
          return;
        }

        if (!plan.action) {
          throw new Error(
            "Agent returned neither an action nor a finish directive."
          );
        }

        const actionValidation = toolRegistry.validateAction(plan.action);
        if (!actionValidation.ok) {
          throw new Error(
            `Invalid action returned: ${actionValidation.issues?.join(", ")}`
          );
        }

        const step = this.createStep(task, plan);
        const execution = await this.executeStep(task, step, plan.action);
        this.finaliseStep(task, step, execution.observation);

        if (execution.didTerminate) {
          await this.finishTask(
            task,
            execution.summary ??
              this.memory.summarise(task, execution.observation)
          );
          return;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown agent error";
        task.lastError = message;
        this.memory.remember(task.id, {
          type: "observation",
          content: `Error: ${message}`,
          timestamp: Date.now(),
        });
        this.emit("task-error", { taskId: task.id, error: message });
        task.updatedAt = Date.now();
        task.status = "failed";
        this.emit("task-failed", { taskId: task.id, error: message });
        return;
      }
    }

    const summary = this.memory.summarise(task, {
      result: "error",
      message: "Max step count reached without completion.",
    });
    await this.completeFromFinish(task, summary, {
      status: "failed",
      summary,
    });
  }

  private async planStep(task: AgentTask): Promise<AgentPlanOutput> {
    const recentMemory = this.memory.getRecent(task.id, 16);
    this.emit("planning-started", {
      taskId: task.id,
      memoryCount: recentMemory.length,
    });

    const plan = await this.modelClient.plan({
      task,
      recentMemory,
      tools: toolRegistry.getTools(),
      stepCount: task.steps.length,
    });

    this.memory.remember(task.id, {
      type: "thought",
      content: plan.thought,
      timestamp: Date.now(),
    });

    this.emit("planning-finished", {
      taskId: task.id,
      thought: plan.thought,
      action: plan.action,
      finish: plan.finish,
    });

    return plan;
  }

  private createStep(task: AgentTask, plan: AgentPlanOutput): AgentStep {
    const step: AgentStep = {
      id: randomUUID(),
      index: task.steps.length,
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      action: plan.action,
      modelThought: plan.thought,
    };
    task.steps.push(step);
    task.updatedAt = Date.now();
    this.emit("step-created", { taskId: task.id, step });
    return step;
  }

  private async executeStep(
    task: AgentTask,
    step: AgentStep,
    action: AgentAction
  ): Promise<ActionExecutionResult> {
    this.emit("step-executing", {
      taskId: task.id,
      stepId: step.id,
      action,
    });
    this.memory.remember(task.id, {
      type: "action",
      content: `${action.type} -> ${JSON.stringify(action.params)}`,
      timestamp: Date.now(),
    });
    const result = await this.executor({ task, step, action });
    return result;
  }

  private finaliseStep(
    task: AgentTask,
    step: AgentStep,
    observation: AgentObservation
  ): void {
    step.status = observation.result === "success" ? "succeeded" : "failed";
    step.observation = observation;
    step.updatedAt = Date.now();
    task.updatedAt = Date.now();

    this.memory.remember(task.id, {
      type: "observation",
      content: `${observation.result.toUpperCase()}: ${observation.message}`,
      timestamp: Date.now(),
      metadata: observation.data,
    });

    this.emit("step-updated", {
      taskId: task.id,
      stepId: step.id,
      step,
    });
  }

  private async completeFromFinish(
    task: AgentTask,
    summary: string,
    finish: NonNullable<AgentPlanOutput["finish"]>
  ): Promise<void> {
    if (finish.status === "success") {
      await this.finishTask(task, summary);
    } else {
      task.status = "failed";
      task.lastError = summary;
      task.summary = summary;
      task.updatedAt = Date.now();
      this.emit("task-failed", { taskId: task.id, error: summary });
    }
  }

  private async finishTask(task: AgentTask, summary: string): Promise<void> {
    task.status = "succeeded";
    task.summary = summary;
    task.updatedAt = Date.now();
    this.emit("task-completed", { taskId: task.id, summary });
    this.memory.remember(task.id, {
      type: "summary",
      content: summary,
      timestamp: Date.now(),
    });
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    this.emitter.emit(event, payload);
  }
}


