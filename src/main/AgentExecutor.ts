import type { AgentExecutor, AgentObservation } from "../agent-server/types";
import type { Window } from "./Window";
import type { Tab } from "./Tab";
import { agentSafetyConfig } from "./guardrails/config";

interface NavigateParams {
  url?: unknown;
  waitFor?: unknown;
  tabId?: unknown;
}

interface ClickParams {
  selector?: unknown;
  button?: unknown;
  waitForNavigation?: unknown;
  tabId?: unknown;
}

interface TypeParams {
  selector?: unknown;
  text?: unknown;
  clear?: unknown;
  submit?: unknown;
  tabId?: unknown;
}

interface WaitParams {
  ms?: unknown;
  until?: unknown;
  timeoutMs?: unknown;
  tabId?: unknown;
}

interface ScrollParams {
  direction?: unknown;
  amount?: unknown;
  selector?: unknown;
  tabId?: unknown;
}

interface ExtractParams {
  selector?: unknown;
  attribute?: unknown;
  purpose?: unknown;
  tabId?: unknown;
}

const SELECTOR_TIMEOUT = agentSafetyConfig.maxWaitMs;

export function createAgentExecutor(window: Window): AgentExecutor {
  return async ({ action }) => {
    try {
      switch (action.type) {
        case "navigate":
          return await handleNavigate(window, action.params as NavigateParams);
        case "click":
          return await handleClick(window, action.params as ClickParams);
        case "type":
          return await handleType(window, action.params as TypeParams);
        case "wait":
          return await handleWait(window, action.params as WaitParams);
        case "scroll":
          return await handleScroll(window, action.params as ScrollParams);
        case "extract":
          return await handleExtract(window, action.params as ExtractParams);
        case "finish":
          return {
            observation: {
              result: "success",
              message: "Task marked as finished.",
            },
            didTerminate: true,
          };
        default:
          return {
            observation: {
              result: "error",
              message: `Unsupported action type ${String(action.type)}.`,
            },
            didTerminate: true,
          };
      }
    } catch (error) {
      return {
        observation: {
          result: "error",
          message:
            error instanceof Error ? error.message : "Unknown executor error.",
        },
      };
    }
  };
}

async function handleNavigate(
  window: Window,
  params: NavigateParams
): Promise<{ observation: AgentObservation }> {
  const tab = resolveTab(window, params.tabId);
  if (!tab) {
    return {
      observation: {
        result: "error",
        message: "No active tab available for navigation.",
      },
    };
  }
  const url = typeof params.url === "string" ? params.url : null;
  if (!url) {
    throw new Error("navigate action requires a URL string.");
  }
  if (agentSafetyConfig.blockedOrigins.some((prefix) => url.startsWith(prefix))) {
    throw new Error(`Navigation to URLs starting with "${url.split(":")[0]}:" is blocked by safety policy.`);
  }
  await tab.loadURL(url);
  const waitFor =
    typeof params.waitFor === "string" && params.waitFor.trim().length > 0
      ? params.waitFor
      : null;
  if (waitFor) {
    const waitResult = await waitForSelector(tab, waitFor);
    if (!waitResult.found) {
      return {
        observation: {
          result: "error",
          message: `Navigated to ${url}, but selector "${waitFor}" not found within timeout.`,
        },
      };
    }
  }
  return {
    observation: {
      result: "success",
      message: `Navigated to ${url}.`,
      data: { url },
    },
  };
}

async function handleClick(
  window: Window,
  params: ClickParams
): Promise<{ observation: AgentObservation }> {
  const tab = resolveTab(window, params.tabId);
  if (!tab) {
    return {
      observation: {
        result: "error",
        message: "No active tab available for click action.",
      },
    };
  }
  const selector = typeof params.selector === "string" ? params.selector : null;
  if (!selector) {
    throw new Error("click action requires a CSS selector string.");
  }
  if (agentSafetyConfig.restrictedSelectors.includes(selector)) {
    throw new Error(`Clicks on selector "${selector}" are blocked by safety policy.`);
  }
  const button =
    typeof params.button === "string" ? params.button.toLowerCase() : "left";
  const script = `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const button = ${JSON.stringify(button)};
      const target = document.querySelector(selector);
      if (!target) {
        return { ok: false, message: "Selector not found." };
      }
      target.scrollIntoView({ block: "center", inline: "center" });
      const events = ["mouseover", "mousedown", "mouseup", "click"];
      for (const type of events) {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: button === "middle" ? 1 : button === "right" ? 2 : 0,
        });
        target.dispatchEvent(event);
      }
      return { ok: true, text: target.textContent?.trim() ?? "" };
    })()
  `;
  const result = (await tab.runJs(script)) as
    | { ok: true; text?: string }
    | { ok: false; message: string };
  if (!result?.ok) {
    return {
      observation: {
        result: "error",
        message: result?.message ?? "Click script failed.",
      },
    };
  }

  const waitForNavigation =
    typeof params.waitForNavigation === "boolean"
      ? params.waitForNavigation
      : false;
  if (waitForNavigation) {
    await waitForDidFinishLoad(tab);
  }

  return {
    observation: {
      result: "success",
      message: `Clicked ${selector}.`,
      data: { text: result.text },
    },
  };
}

async function handleType(
  window: Window,
  params: TypeParams
): Promise<{ observation: AgentObservation }> {
  const tab = resolveTab(window, params.tabId);
  if (!tab) {
    return {
      observation: {
        result: "error",
        message: "No active tab available for type action.",
      },
    };
  }
  const selector = typeof params.selector === "string" ? params.selector : null;
  const text = typeof params.text === "string" ? params.text : null;
  if (!selector || text === null) {
    throw new Error("type action requires selector and text parameters.");
  }
  if (agentSafetyConfig.restrictedSelectors.includes(selector)) {
    throw new Error(`Typing into selector "${selector}" is blocked by safety policy.`);
  }
  const clear = Boolean(params.clear);
  const submit = Boolean(params.submit);
  const script = `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const text = ${JSON.stringify(text)};
      const clearBefore = ${JSON.stringify(clear)};
      const submitAfter = ${JSON.stringify(submit)};
      const target = document.querySelector(selector);
      if (!target) {
        return { ok: false, message: "Selector not found." };
      }
      target.scrollIntoView({ block: "center", inline: "center" });
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (clearBefore) target.value = "";
        target.focus();
        target.value += text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        if (submitAfter) {
          if (target.form) {
            target.form.requestSubmit();
          } else {
            const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
            target.dispatchEvent(event);
          }
        }
        return { ok: true, value: target.value };
      }
      if ((target as HTMLElement).isContentEditable) {
        if (clearBefore) target.textContent = "";
        target.focus();
        target.textContent += text;
        if (submitAfter) {
          const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
          target.dispatchEvent(event);
        }
        return { ok: true, value: target.textContent ?? "" };
      }
      return { ok: false, message: "Target element is not editable." };
    })()
  `;
  const result = (await tab.runJs(script)) as
    | { ok: true; value: string }
    | { ok: false; message: string };
  if (!result?.ok) {
    return {
      observation: {
        result: "error",
        message: result?.message ?? "Typing script failed.",
      },
    };
  }
  return {
    observation: {
      result: "success",
      message: `Typed into ${selector}.`,
      data: { value: result.value },
    },
  };
}

async function handleWait(
  window: Window,
  params: WaitParams
): Promise<{ observation: AgentObservation }> {
  const tab = resolveTab(window, params.tabId);
  if (!tab) {
    return {
      observation: {
        result: "error",
        message: "No active tab available for wait action.",
      },
    };
  }
  const ms =
    typeof params.ms === "number"
      ? params.ms
      : typeof params.ms === "string"
      ? Number(params.ms)
      : undefined;
  const until =
    typeof params.until === "string" && params.until.trim().length > 0
      ? params.until
      : undefined;
  const timeout =
    typeof params.timeoutMs === "number"
      ? params.timeoutMs
      : typeof params.timeoutMs === "string"
      ? Number(params.timeoutMs)
      : SELECTOR_TIMEOUT;
  const effectiveTimeout = Math.min(timeout ?? SELECTOR_TIMEOUT, agentSafetyConfig.maxWaitMs);

  if (!ms && !until) {
    throw new Error("wait action requires either ms or until parameter.");
  }

  if (ms && !until) {
    const clamped = Math.min(Math.max(0, ms), agentSafetyConfig.maxWaitMs);
    await new Promise((resolve) => setTimeout(resolve, clamped));
    return {
      observation: {
        result: "success",
        message: `Waited for ${clamped}ms.`,
      },
    };
  }

  if (until) {
    const result = await waitForSelector(tab, until, effectiveTimeout);
    if (!result.found) {
      return {
        observation: {
          result: "error",
          message: `Timeout waiting for selector "${until}".`,
        },
      };
    }
    return {
      observation: {
        result: "success",
        message: `Selector "${until}" appeared.`,
        data: { text: result.text },
      },
    };
  }

  return {
    observation: {
      result: "success",
      message: "Wait completed.",
    },
  };
}

async function handleScroll(
  window: Window,
  params: ScrollParams
): Promise<{ observation: AgentObservation }> {
  const tab = resolveTab(window, params.tabId);
  if (!tab) {
    return {
      observation: {
        result: "error",
        message: "No active tab available for scroll action.",
      },
    };
  }
  const direction =
    typeof params.direction === "string"
      ? params.direction.toLowerCase()
      : "down";
  const amount =
    typeof params.amount === "number"
      ? params.amount
      : typeof params.amount === "string"
      ? Number(params.amount)
      : 0.6;
  const selector =
    typeof params.selector === "string" && params.selector.trim().length > 0
      ? params.selector
      : null;
  const script = `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const direction = ${JSON.stringify(direction)};
      const amount = ${JSON.stringify(amount)};
      const element = selector ? document.querySelector(selector) : document.scrollingElement || document.body;
      if (!element) {
        return { ok: false, message: "Scrollable element not found." };
      }
      const maxScroll = element.scrollHeight - element.clientHeight;
      const delta =
        direction === "top" ? -maxScroll :
        direction === "bottom" ? maxScroll :
        direction === "up" ? -element.clientHeight * amount :
        element.clientHeight * amount;
      element.scrollBy({ top: delta, behavior: "smooth" });
      return {
        ok: true,
        top: element.scrollTop,
        height: element.scrollHeight,
      };
    })()
  `;
  const result = (await tab.runJs(script)) as
    | { ok: true; top: number; height: number }
    | { ok: false; message: string };
  if (!result?.ok) {
    return {
      observation: {
        result: "error",
        message: result?.message ?? "Scroll script failed.",
      },
    };
  }
  return {
    observation: {
      result: "success",
      message: `Scrolled ${direction}.`,
      data: { offset: result.top, scrollHeight: result.height },
    },
  };
}

async function handleExtract(
  window: Window,
  params: ExtractParams
): Promise<{ observation: AgentObservation }> {
  const tab = resolveTab(window, params.tabId);
  if (!tab) {
    return {
      observation: {
        result: "error",
        message: "No active tab available for extract action.",
      },
    };
  }
  const selector = typeof params.selector === "string" ? params.selector : "*";
  const attribute =
    typeof params.attribute === "string" ? params.attribute : "textContent";
  const script = `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const attribute = ${JSON.stringify(attribute)};
      const elements = Array.from(document.querySelectorAll(selector));
      const values = elements
        .map((el) => {
          if (attribute === "textContent") return el.textContent?.trim() ?? "";
          if (attribute === "innerHTML") return el.innerHTML ?? "";
          return el.getAttribute(attribute) ?? "";
        })
        .filter((value) => value && value.length > 0)
        .slice(0, 10);
      return { count: values.length, values };
    })()
  `;
  const result = (await tab.runJs(script)) as { count: number; values: string[] };
  if (!result || result.count === 0) {
    return {
      observation: {
        result: "error",
        message: `No content extracted using selector "${selector}" and attribute "${attribute}".`,
      },
    };
  }
  return {
    observation: {
      result: "success",
      message: `Extracted ${result.count} items using selector "${selector}".`,
      data: { samples: result.values },
    },
  };
}

function resolveTab(window: Window, tabId: unknown): Tab | null {
  if (typeof tabId === "string" && tabId.length > 0) {
    const specific = window.getTab(tabId);
    if (specific) return specific;
  }
  return window.activeTab;
}

async function waitForSelector(
  tab: Tab,
  selector: string,
  timeout: number = SELECTOR_TIMEOUT
): Promise<{ found: boolean; text?: string | null }> {
  const safeTimeout = Math.min(timeout, agentSafetyConfig.maxWaitMs);
  const script = `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const timeout = ${safeTimeout};
      return new Promise((resolve) => {
        const started = performance.now();
        const poll = () => {
          const node = document.querySelector(selector);
          if (node) {
            resolve({ found: true, text: node.textContent?.trim() ?? null });
            return;
          }
          if (performance.now() - started > timeout) {
            resolve({ found: false });
            return;
          }
          setTimeout(poll, 200);
        };
        poll();
      });
    })()
  `;
  return (await tab.runJs(script)) as { found: boolean; text?: string | null };
}

function waitForDidFinishLoad(tab: Tab): Promise<void> {
  return new Promise((resolve, reject) => {
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onFail = (_event: unknown, errorCode: number, errorDescription: string) => {
      cleanup();
      reject(new Error(`Navigation failed: ${errorDescription} (${errorCode})`));
    };
    const cleanup = () => {
      tab.webContents.removeListener("did-finish-load", onFinish);
      tab.webContents.removeListener("did-fail-load", onFail);
    };
    tab.webContents.once("did-finish-load", onFinish);
    tab.webContents.once("did-fail-load", onFail);
  });
}


