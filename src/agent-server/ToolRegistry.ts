import { AgentAction, AgentActionType, AgentToolDefinition } from "./types";

const TOOL_DEFINITIONS: Record<AgentActionType, AgentToolDefinition> = {
  navigate: {
    name: "navigate",
    description: "Open a new URL in the active tab.",
    schema: {
      url: { description: "Absolute URL to open", required: true },
      tabId: {
        description: "Optional tab id, defaults to current active tab.",
      },
      waitFor: {
        description:
          "Optional selector or keyword to wait for before proceeding.",
      },
    },
    execution: { invokesExecutor: true, expectedLatencyMs: 2000 },
    safetyNotes: [
      "Only navigate to URLs relevant to the current goal.",
      "Avoid triggering downloads or destructive actions.",
    ],
  },
  click: {
    name: "click",
    description: "Simulate a mouse click on an element.",
    schema: {
      selector: {
        description: "CSS selector targeting the element to click.",
        required: true,
      },
      tabId: {
        description: "Optional tab id, defaults to current active tab.",
      },
      button: {
        description: "Mouse button to use (left, right, middle). Defaults left.",
      },
      waitForNavigation: {
        description:
          "Set true if the click is expected to trigger navigation.",
      },
    },
    execution: { invokesExecutor: true, expectedLatencyMs: 1500 },
    safetyNotes: [
      "Avoid clicking destructive UI (delete, submit irreversible forms).",
      "Verify selector uniqueness before clicking.",
    ],
  },
  type: {
    name: "type",
    description: "Type text into an input or editable element.",
    schema: {
      selector: { description: "CSS selector of input element.", required: true },
      text: { description: "Text to type into the field.", required: true },
      tabId: {
        description: "Optional tab id, defaults to current active tab.",
      },
      submit: {
        description:
          "Set true to submit the form after typing (e.g., pressing Enter).",
      },
      clear: {
        description: "Set true to clear the input before typing.",
      },
    },
    execution: { invokesExecutor: true, expectedLatencyMs: 1200 },
    safetyNotes: ["Never type secrets or credentials unprompted."],
  },
  wait: {
    name: "wait",
    description: "Pause execution while waiting for a condition.",
    schema: {
      ms: {
        description: "Milliseconds to wait when using a fixed delay.",
      },
      tabId: {
        description: "Optional tab id, defaults to current active tab.",
      },
      until: {
        description:
          "CSS selector or keyword condition to wait for to appear.",
      },
      timeoutMs: {
        description: "Optional timeout for condition waits.",
      },
    },
    execution: { invokesExecutor: true, expectedLatencyMs: 1000 },
    safetyNotes: [
      "Use sparingly to avoid long blocking operations.",
      "Prefer condition waits over static delays when possible.",
    ],
  },
  scroll: {
    name: "scroll",
    description: "Scroll within the page to reveal new content.",
    schema: {
      direction: {
        description: "Direction to scroll (down, up, top, bottom).",
        required: true,
      },
      tabId: {
        description: "Optional tab id, defaults to current active tab.",
      },
      amount: {
        description:
          "Either pixel value or proportional amount to scroll (0-1).",
      },
      selector: {
        description: "Optional selector for a scrollable container.",
      },
    },
    execution: { invokesExecutor: true, expectedLatencyMs: 800 },
    safetyNotes: [
      "Ensure scrolling direction aligns with content layout.",
      "Avoid infinite scrolling loops.",
    ],
  },
  extract: {
    name: "extract",
    description: "Extract structured information from the page.",
    schema: {
      selector: {
        description:
          "CSS selector targeting elements containing desired content.",
      },
      tabId: {
        description: "Optional tab id, defaults to current active tab.",
      },
      attribute: {
        description:
          "Attribute name to read (e.g., textContent, href, value).",
        required: true,
      },
      purpose: {
        description: "Reason for extraction to guide LLM summarisation.",
      },
    },
    execution: { invokesExecutor: true, expectedLatencyMs: 1800 },
    safetyNotes: [
      "Only extract publicly visible information.",
      "Respect privacy and compliance requirements.",
    ],
  },
  finish: {
    name: "finish",
    description: "Indicate the task is complete with a final summary.",
    schema: {
      status: {
        description: "success or failed",
        required: true,
      },
      summary: {
        description: "Explanation for the current status.",
        required: true,
      },
    },
    execution: { invokesExecutor: false, expectedLatencyMs: 0 },
    safetyNotes: ["Use only to conclude the task."],
  },
};

export class ToolRegistry {
  getTools(): AgentToolDefinition[] {
    return Object.values(TOOL_DEFINITIONS);
  }

  getTool(type: AgentActionType): AgentToolDefinition | undefined {
    return TOOL_DEFINITIONS[type];
  }

  validateAction(action: AgentAction): {
    ok: boolean;
    issues?: string[];
  } {
    const tool = this.getTool(action.type);
    if (!tool) {
      return { ok: false, issues: [`Unknown tool "${action.type}".`] };
    }
    const issues: string[] = [];
    for (const [key, rules] of Object.entries(tool.schema)) {
      const value = (action.params as Record<string, unknown>)[key];
      if (rules.required && (value === undefined || value === null)) {
        issues.push(`Missing required parameter "${key}" for ${action.type}.`);
      }
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  }

  describeAction(action: AgentAction): string {
    const entries = Object.entries(action.params ?? {})
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(", ");
    return `${action.type}${entries ? ` (${entries})` : ""}`;
  }
}

export const toolRegistry = new ToolRegistry();


