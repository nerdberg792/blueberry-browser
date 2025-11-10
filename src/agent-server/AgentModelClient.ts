import { join } from "path";
import * as dotenv from "dotenv";
import {
  type LanguageModel,
  generateText,
  type CoreMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import {
  AgentPlanOutput,
  AgentTask,
  AgentToolDefinition,
} from "./types";
import { MemoryEntry } from "./AgentMemory";
import { parseJsonFromText } from "./utils/json";
import { agentSafetyConfig } from "../main/guardrails/config";

dotenv.config({ path: join(__dirname, "../../.env") });

type Provider = "openai" | "anthropic" | "gemini";

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  gemini: "gemini-2.5-pro",
};

export interface PlanInput {
  task: AgentTask;
  recentMemory: MemoryEntry[];
  tools: AgentToolDefinition[];
  stepCount: number;
}

export class AgentModelClient {
  private readonly provider: Provider;
  private readonly modelName: string;
  private readonly model: LanguageModel | null;

  constructor() {
    this.provider = this.resolveProvider();
    this.modelName = this.resolveModelName();
    this.model = this.initialiseModel();
  }

  private resolveProvider(): Provider {
    const value = process.env.AGENT_MODEL_PROVIDER?.toLowerCase();
    if (value === "anthropic") return "anthropic";
    if (value === "gemini" || value === "google") return "gemini";
    return "openai";
  }

  private resolveModelName(): string {
    return process.env.AGENT_MODEL ?? DEFAULT_MODELS[this.provider];
  }

  private initialiseModel(): LanguageModel | null {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      console.warn(
        "[AgentModel] Missing API key. Set OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY."
      );
      return null;
    }
    switch (this.provider) {
      case "openai":
        return openai(this.modelName);
      case "anthropic":
        return anthropic(this.modelName);
      case "gemini":
        return google(this.modelName);
      default:
        return null;
    }
  }

  private resolveApiKey(): string | undefined {
    switch (this.provider) {
      case "openai":
        return process.env.OPENAI_API_KEY;
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY;
      case "gemini":
        return (
          process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY
        );
      default:
        return undefined;
    }
  }

  get isReady(): boolean {
    return Boolean(this.model);
  }

  async plan(input: PlanInput): Promise<AgentPlanOutput> {
    if (!this.model) {
      throw new Error("Agent model is not ready. Set the appropriate API key.");
    }

    const prompt = this.buildPrompt(input);

    const { text } = await generateText({
      model: this.model,
      temperature: 0.1,
      maxOutputTokens: 800,
      prompt,
    });

    const parsed = parseJsonFromText(text);
    if (!parsed) {
      throw new Error(
        "Agent model returned an unparsable response. Expected JSON payload."
      );
    }

    return parsed as AgentPlanOutput;
  }

  private buildPrompt(input: PlanInput): string {
    const lines: string[] = [];
    lines.push(
      "You are an autonomous browsing agent entrusted to accomplish user goals.",
      "You must reason carefully, act safely, and return a valid JSON object describing your next step.",
      `You are limited to ${agentSafetyConfig.maxSteps} actions per task and each wait may not exceed ${agentSafetyConfig.maxWaitMs}ms.`,
      `Never visit pages whose URL begins with: ${agentSafetyConfig.blockedOrigins.join(", ")}.`,
      `Never interact with elements matching: ${agentSafetyConfig.restrictedSelectors.join(", ")}.`,
      "",
      `Goal: ${input.task.goal}`
    );
    if (input.task.context?.url) {
      lines.push(`Current URL: ${input.task.context.url}`);
    }
    if (input.task.context?.pageTitle) {
      lines.push(`Page title: ${input.task.context.pageTitle}`);
    }
    if (input.task.context?.pageDescription) {
      lines.push(`Page description: ${input.task.context.pageDescription}`);
    }
    if (input.task.context?.startingHtmlExcerpt) {
      lines.push(
        "Initial HTML excerpt:",
        this.truncate(input.task.context.startingHtmlExcerpt, 1500)
      );
    }
    lines.push("");
    if (input.recentMemory.length) {
      lines.push("Recent history:");
      for (const entry of input.recentMemory.slice(-12)) {
        lines.push(
          `- [${new Date(entry.timestamp).toISOString()}] ${entry.type.toUpperCase()}: ${entry.content}`
        );
      }
      lines.push("");
    }

    lines.push("Available tools (only use these actions):");
    for (const tool of input.tools) {
      lines.push(
        `- ${tool.name}: ${tool.description}`,
        `  Required params: ${Object.entries(tool.schema)
          .filter(([, rules]) => rules.required)
          .map(([key]) => key)
          .join(", ") || "none"}`
      );
      if (tool.safetyNotes?.length) {
        lines.push(
          `  Safety: ${tool.safetyNotes.map((note) => `"${note}"`).join(", ")}`
        );
      }
    }
    lines.push("");
    lines.push(
      "Output requirements:",
      "- Always respond with valid JSON only. No additional commentary.",
      '- Schema: {"thought": string, "action"?: { "type": string, "params": object }, "finish"?: {"status": "success"|"failed", "summary": string}, "caution"?: string}',
      "- Use finish when the goal is achieved or cannot continue.",
      "- Never invent tools or parameters. Use only listed tools."
    );
    lines.push("");
    lines.push("Remember: behave cautiously and avoid harmful actions.");

    return lines.join("\n");
  }

  private truncate(value: string, limit: number): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}…`;
  }
}


