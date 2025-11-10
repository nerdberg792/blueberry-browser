import { AgentObservation, AgentTask } from "./types";

export type MemoryEntryType = "thought" | "action" | "observation" | "summary";

export interface MemoryEntry {
  type: MemoryEntryType;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export class AgentMemory {
  private entriesByTask = new Map<string, MemoryEntry[]>();

  remember(taskId: string, entry: MemoryEntry): void {
    const list = this.entriesByTask.get(taskId) ?? [];
    list.push(entry);
    this.entriesByTask.set(taskId, list);
  }

  getRecent(taskId: string, limit = 10): MemoryEntry[] {
    const list = this.entriesByTask.get(taskId) ?? [];
    if (limit <= 0 || list.length <= limit) {
      return [...list];
    }
    return list.slice(-limit);
  }

  summarise(task: AgentTask, observation: AgentObservation): string {
    const parts: string[] = [
      `Goal: ${task.goal}`,
      `Result: ${observation.result.toUpperCase()}`,
      observation.message,
    ];
    if (observation.data) {
      const serialised = Object.entries(observation.data)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join("\n");
      if (serialised.length > 0) {
        parts.push("\nAdditional Data:\n" + serialised);
      }
    }
    const summary = parts.join("\n");
    this.remember(task.id, {
      type: "summary",
      content: summary,
      timestamp: Date.now(),
    });
    return summary;
  }

  clear(taskId: string): void {
    this.entriesByTask.delete(taskId);
  }
}


