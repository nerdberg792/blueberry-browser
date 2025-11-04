import { WebContents } from "electron";
import { streamText, type LanguageModel, type CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

interface ChatRequest {
  message: string;
  messageId: string;
  styleMode?: boolean;
  lockStyles?: boolean;
}

interface StreamChunk {
  content: string;
  isComplete: boolean;
}

type LLMProvider = "openai" | "anthropic" | "gemini";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  gemini: "gemini-2.5-pro",
};

const MAX_CONTEXT_LENGTH = 4000;
const DEFAULT_TEMPERATURE = 0.7;

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly provider: LLMProvider;
  private readonly modelName: string;
  private readonly model: LanguageModel | null;
  private messages: CoreMessage[] = [];
  private styleCssKeyByTabId: Map<string, string> = new Map();

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.provider = this.getProvider();
    this.modelName = this.getModelName();
    this.model = this.initializeModel();

    this.logInitializationStatus();
  }

  // Set the window reference after construction to avoid circular dependencies
  setWindow(window: Window): void {
    this.window = window;
  }

  private getProvider(): LLMProvider {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    if (provider === "gemini" || provider === "google") return "gemini";
    return "openai"; // Default to OpenAI
  }

  private getModelName(): string {
    return process.env.LLM_MODEL || DEFAULT_MODELS[this.provider];
  }

  private initializeModel(): LanguageModel | null {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    switch (this.provider) {
      case "anthropic":
        return anthropic(this.modelName);
      case "openai":
        return openai(this.modelName);
      case "gemini":
        return google(this.modelName);
      default:
        return null;
    }
  }

  private getApiKey(): string | undefined {
    switch (this.provider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY;
      case "openai":
        return process.env.OPENAI_API_KEY;
      case "gemini":
        return (
          process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
          process.env.GEMINI_API_KEY
        );
      default:
        return undefined;
    }
  }

  private logInitializationStatus(): void {
    if (this.model) {
      console.log(
        `✅ LLM Client initialized with ${this.provider} provider using model: ${this.modelName}`
      );
    } else {
      const keyName =
        this.provider === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : this.provider === "gemini"
          ? "GOOGLE_GENERATIVE_AI_API_KEY"
          : "OPENAI_API_KEY";
      console.error(
        `❌ LLM Client initialization failed: ${keyName} not found in environment variables.\n` +
          `Please add your API key to the .env file in the project root.`
      );
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      // Get screenshot from active tab if available
      let screenshot: string | null = null;
      let pageHtml: string | null = null;
      let activeTabId: string | null = null;
      if (this.window) {
        const activeTab = this.window.activeTab;
        if (activeTab) {
          activeTabId = activeTab.id;
          try {
            const image = await activeTab.screenshot();
            screenshot = image.toDataURL();
          } catch (error) {
            console.error("Failed to capture screenshot:", error);
          }

          if (request.styleMode) {
            try {
              pageHtml = await activeTab.getTabHtml();
            } catch (error) {
              console.error("Failed to get page HTML:", error);
            }
          }
        }
      }

      // Build user message content with screenshot first, then text
      const userContent: any[] = [];
      
      // Add screenshot as the first part if available
      if (screenshot) {
        userContent.push({
          type: "image",
          image: screenshot,
        });
      }
      
      // Add text content
      userContent.push({
        type: "text",
        text: request.message,
      });

      // Create user message in CoreMessage format
      const userMessage: CoreMessage = {
        role: "user",
        content: userContent.length === 1 ? request.message : userContent,
      };
      
      this.messages.push(userMessage);

      // Send updated messages to renderer
      this.sendMessagesToRenderer();

      if (!this.model) {
        this.sendErrorMessage(
          request.messageId,
          "LLM service is not configured. Please add your API key to the .env file."
        );
        return;
      }

      const messages = await this.prepareMessagesWithContext(request, pageHtml);
      await this.streamResponse(messages, request.messageId, {
        styleMode: !!request.styleMode,
        activeTabId,
        lockStyles: !!request.lockStyles,
      });
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.sendMessagesToRenderer();
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  private sendMessagesToRenderer(): void {
    this.webContents.send("chat-messages-updated", this.messages);
  }

  private async prepareMessagesWithContext(request: ChatRequest, pageHtml: string | null): Promise<CoreMessage[]> {
    // Get page context from active tab
    let pageUrl: string | null = null;
    let pageText: string | null = null;
    
    if (this.window) {
      const activeTab = this.window.activeTab;
      if (activeTab) {
        pageUrl = activeTab.url;
        try {
          pageText = await activeTab.getTabText();
        } catch (error) {
          console.error("Failed to get page text:", error);
        }
      }
    }

    // Build system message
    const systemMessage: CoreMessage = {
      role: "system",
      content: request.styleMode
        ? this.buildStyleModeSystemPrompt(pageUrl, pageHtml)
        : this.buildSystemPrompt(pageUrl, pageText),
    };

    // Include all messages in history (system + conversation)
    return [systemMessage, ...this.messages];
  }

  private buildSystemPrompt(url: string | null, pageText: string | null): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include screenshots of the current page as the first image.",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage content (text):\n${truncatedText}`);
    }

    parts.push(
      "\nPlease provide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided."
    );

    return parts.join("\n");
  }

  private buildStyleModeSystemPrompt(url: string | null, pageHtml: string | null): string {
    const parts: string[] = [
      "You are a front-end stylist. Output ONLY raw CSS, no explanations.",
      "Rules:",
      "- Do not include <style> tags or Markdown fences.",
      "- Target existing elements/classes from the provided HTML.",
      "- Non-destructive visual changes only (colors, spacing, typography, subtle layout).",
      "- Avoid animations that hinder usability; keep it tasteful/funky.",
      "- Prefer CSS variables if present; otherwise direct properties are fine.",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (pageHtml) {
      const truncated = this.truncateText(pageHtml, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage HTML (truncated):\n${truncated}`);
    }

    parts.push("\nReturn only valid CSS.");
    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async streamResponse(
    messages: CoreMessage[],
    messageId: string,
    options?: { styleMode: boolean; activeTabId: string | null; lockStyles: boolean }
  ): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    try {
      const result = await streamText({
        model: this.model,
        messages,
        temperature: DEFAULT_TEMPERATURE,
        maxRetries: 3,
        abortSignal: undefined, // Could add abort controller for cancellation
      });

      await this.processStream(result.textStream, messageId, options);
    } catch (error) {
      throw error; // Re-throw to be handled by the caller
    }
  }

  private async processStream(
    textStream: AsyncIterable<string>,
    messageId: string,
    options?: { styleMode: boolean; activeTabId: string | null; lockStyles: boolean }
  ): Promise<void> {
    let accumulatedText = "";

    // Create a placeholder assistant message
    const assistantMessage: CoreMessage = {
      role: "assistant",
      content: "",
    };
    
    // Keep track of the index for updates
    const messageIndex = this.messages.length;
    this.messages.push(assistantMessage);

    for await (const chunk of textStream) {
      accumulatedText += chunk;

      // Update assistant message content
      this.messages[messageIndex] = {
        role: "assistant",
        content: accumulatedText,
      };
      this.sendMessagesToRenderer();

      this.sendStreamChunk(messageId, {
        content: chunk,
        isComplete: false,
      });
    }

    // Final update with complete content
    this.messages[messageIndex] = {
      role: "assistant",
      content: accumulatedText,
    };
    this.sendMessagesToRenderer();

    // Send the final complete signal
    this.sendStreamChunk(messageId, {
      content: accumulatedText,
      isComplete: true,
    });

    // If style mode, inject CSS into the active tab
    if (options?.styleMode && this.window && options.activeTabId) {
      const activeTab = this.window.activeTab;
      if (activeTab && activeTab.id === options.activeTabId) {
        const rawCss = this.extractRawCss(accumulatedText);
        const css = this.transformCssForSpecificity(rawCss);
        try {
          // Remove previously inserted CSS for this tab if exists
          const previousKey = this.styleCssKeyByTabId.get(options.activeTabId);
          if (previousKey) {
            try {
              await activeTab.webContents.removeInsertedCSS(previousKey);
            } catch {
              // ignore removal errors
            }
          }

          const key = await activeTab.webContents.insertCSS(css, { cssOrigin: "user" });
          this.styleCssKeyByTabId.set(options.activeTabId, key);
          // Fallback: also inject via DOM (handles Shadow DOM/precedence cases)
          await this.injectCssViaDom(css, options.lockStyles);
          // Inline-style applier to mimic DevTools (last resort)
          await this.applyInlineStyles(rawCss, options.lockStyles);
        } catch (err) {
          console.error("Failed to insert CSS:", err);
          // Attempt DOM injection even if insertCSS failed
          try {
            await this.injectCssViaDom(css, options.lockStyles);
            await this.applyInlineStyles(rawCss, options.lockStyles);
          } catch (e) {
            console.error("Failed DOM CSS injection:", e);
          }
        }
      }
    }
  }

  private extractRawCss(text: string): string {
    // Strip Markdown fences and <style> wrappers if present
    let css = text.trim();
    // Prefer the first fenced block anywhere in the text
    const anyFenceRegex = /```[a-zA-Z]*\n([\s\S]*?)\n```/m;
    const anyFenceMatch = css.match(anyFenceRegex);
    if (anyFenceMatch) {
      css = anyFenceMatch[1];
    } else {
      // If backticks exist but pattern above didn't match (missing newlines), strip backticks greedily
      css = css.replace(/```[a-zA-Z]*/g, "").replace(/```/g, "");
    }
    // <style> ... </style>
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/i;
    const styleMatch = css.match(styleRegex);
    if (styleMatch) {
      css = styleMatch[1];
    }
    return css.trim();
  }

  private transformCssForSpecificity(css: string): string {
    // Add !important to each declaration (skip @ rules and comments)
    const rules = css.split(/}\s*/).map((block) => block.trim()).filter(Boolean);
    const transformed: string[] = [];
    for (const rule of rules) {
      const parts = rule.split("{");
      if (parts.length < 2) {
        continue;
      }
      const selector = parts[0].trim();
      const body = parts.slice(1).join("{");
      if (selector.startsWith("@")) {
        transformed.push(selector + "{" + body + "}");
        continue;
      }
      const lines = body
        .split(";")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => {
          if (l.startsWith("@") || l.startsWith("/*") || l.endsWith("!important")) return l;
          return l + " !important";
        });
      const prefixedSelector = selector
        .split(",")
        .map((s) => s.trim())
        .map((s) => (s.startsWith(":root") || s.startsWith("html") ? s : `:root[data-ai-style-scope] ${s}`))
        .join(", ");
      transformed.push(`${prefixedSelector}{${lines.join("; ")}}`);
    }
    return transformed.join("\n");
  }

  private async injectCssViaDom(css: string, lockStyles?: boolean): Promise<void> {
    if (!this.window || !this.window.activeTab) return;
    const js = `(() => {
      const STYLE_ATTR = 'data-ai-style';
      const OBSERVER_FLAG = '__aiStyleObserver__';
      // Mark scope on root to increase specificity vs utility classes
      try { document.documentElement.setAttribute('data-ai-style-scope','1'); } catch {}
      // Remove previous styles
      document.querySelectorAll('style['+STYLE_ATTR+']').forEach((el) => el.remove());
      const style = document.createElement('style');
      style.setAttribute(STYLE_ATTR, '1');
      style.textContent = ${JSON.stringify(css)};
      (document.head || document.documentElement).appendChild(style);
      // Inject into existing shadow roots
      const injectIntoShadow = (root) => {
        try {
          const s = document.createElement('style');
          s.setAttribute(STYLE_ATTR, '1');
          s.textContent = ${JSON.stringify(css)};
          root.appendChild(s);
        } catch {}
      };
      // Inject into same-origin iframes
      const injectIntoDoc = (doc) => {
        try {
          doc.querySelectorAll('style['+STYLE_ATTR+']').forEach((el) => el.remove());
          const s = doc.createElement('style');
          s.setAttribute(STYLE_ATTR, '1');
          s.textContent = ${JSON.stringify(css)};
          (doc.head || doc.documentElement).appendChild(s);
          const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT);
          let node = walker.nextNode();
          while (node) {
            const el = node;
            if (el.shadowRoot) {
              el.shadowRoot.querySelectorAll('style['+STYLE_ATTR+']').forEach((x) => x.remove());
              injectIntoShadow(el.shadowRoot);
            }
            node = walker.nextNode();
          }
        } catch {}
      };
      document.querySelectorAll('iframe').forEach((ifr) => {
        try { if (ifr.contentDocument) injectIntoDoc(ifr.contentDocument); } catch {}
      });
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
        const el = node;
        if (el.shadowRoot) {
          // Remove previous
          el.shadowRoot.querySelectorAll('style['+STYLE_ATTR+']').forEach((x) => x.remove());
          injectIntoShadow(el.shadowRoot);
        }
        node = walker.nextNode();
      }
      // Set up a singleton observer to handle dynamically added shadow roots and iframes
      if (${lockStyles ? "true" : "false"} && !window[OBSERVER_FLAG]) {
        try {
          const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
              m.addedNodes && m.addedNodes.forEach((n) => {
                if (!(n instanceof Element)) return;
                const el = n;
                if (el.shadowRoot) {
                  el.shadowRoot.querySelectorAll('style['+STYLE_ATTR+']').forEach((x) => x.remove());
                  injectIntoShadow(el.shadowRoot);
                }
                if (el.tagName === 'IFRAME') {
                  try {
                    const d = el.contentDocument;
                    if (d) injectIntoDoc(d);
                  } catch {}
                }
                // If subtree has elements with shadowRoot
                const subWalker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
                let sn = subWalker.nextNode();
                while (sn) {
                  const se = sn;
                  if (se.shadowRoot) {
                    se.shadowRoot.querySelectorAll('style['+STYLE_ATTR+']').forEach((x) => x.remove());
                    injectIntoShadow(se.shadowRoot);
                  }
                  sn = subWalker.nextNode();
                }
              });
            }
          });
          mo.observe(document.documentElement, { childList: true, subtree: true });
          window[OBSERVER_FLAG] = mo;
        } catch {}
      }
    })()`;
    await this.window.activeTab.runJs(js);
  }

  private async applyInlineStyles(css: string, lockStyles?: boolean): Promise<void> {
    if (!this.window || !this.window.activeTab) return;
    const js = `(() => {
      const OBSERVER_FLAG = '__aiInlineObserver__';
      const STYLE_MARK = 'data-ai-inline';
      const root = document;
      const src = ${JSON.stringify(css)};
      const blocks = src.split(/}\s*/).map(b=>b.trim()).filter(Boolean);
      const rules = [];
      for (const b of blocks) {
        const i = b.indexOf('{');
        if (i === -1) continue;
        const sel = b.slice(0,i).trim();
        const body = b.slice(i+1).trim();
        if (!sel || sel.startsWith('@')) continue;
        const decls = body.split(';').map(l=>l.trim()).filter(Boolean).map(l=>{
          const j = l.indexOf(':');
          if (j === -1) return null;
          const prop = l.slice(0,j).trim();
          const val = l.slice(j+1).trim();
          return [prop, val];
        }).filter(Boolean);
        sel.split(',').map(s=>s.trim()).filter(Boolean).forEach(s=>rules.push([s, decls]));
      }
      const apply = () => {
        for (const [sel, decls] of rules) {
          let scope = root;
          try {
            const list = (scope.querySelectorAll ? scope : document).querySelectorAll(sel);
            list.forEach((el) => {
              try {
                decls.forEach(([p,v]) => {
                  if (!p || !v) return;
                  el.style.setProperty(p, v.replace(/!important/gi, ''), 'important');
                });
                el.setAttribute(STYLE_MARK, '1');
              } catch {}
            });
          } catch {}
        }
      };
      apply();
      if (${lockStyles ? "true" : "false"} && !window[OBSERVER_FLAG]) {
        try {
          const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
              if (m.type === 'childList') {
                m.addedNodes && m.addedNodes.forEach((n) => {
                  if (n instanceof Element) apply();
                });
              } else if (m.type === 'attributes') {
                if (m.target instanceof Element) apply();
              }
            }
          });
          mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
          window[OBSERVER_FLAG] = mo;
        } catch {}
      }
    })()`;
    await this.window.activeTab.runJs(js);
  }

  public async clearInjectedStyles(): Promise<void> {
    if (!this.window || !this.window.activeTab) return;
    try {
      const activeTabId = this.window.activeTab.id;
      const previousKey = this.styleCssKeyByTabId.get(activeTabId);
      if (previousKey) {
        try { await this.window.activeTab.webContents.removeInsertedCSS(previousKey); } catch {}
        this.styleCssKeyByTabId.delete(activeTabId);
      }
      const js = `(() => {
        const STYLE_ATTR = 'data-ai-style';
        document.querySelectorAll('style['+STYLE_ATTR+']').forEach((el) => el.remove());
        try { document.documentElement.removeAttribute('data-ai-style-scope'); } catch {}
        // Disconnect observers
        try { if (window.__aiStyleObserver__) { window.__aiStyleObserver__.disconnect(); delete window.__aiStyleObserver__; } } catch {}
        try { if (window.__aiInlineObserver__) { window.__aiInlineObserver__.disconnect(); delete window.__aiInlineObserver__; } } catch {}
        const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
        let node = walker.nextNode();
        while (node) {
          const el = node;
          if (el.shadowRoot) {
            try { el.shadowRoot.querySelectorAll('style['+STYLE_ATTR+']').forEach((x) => x.remove()); } catch {}
          }
          if (el.tagName === 'IFRAME') {
            try { const d = el.contentDocument; if (d) d.querySelectorAll('style['+STYLE_ATTR+']').forEach((x) => x.remove()); } catch {}
          }
          node = walker.nextNode();
        }
      })()`;
      await this.window.activeTab.runJs(js);
    } catch (e) {
      console.error('Failed to clear injected styles', e);
    }
  }

  private handleStreamError(error: unknown, messageId: string): void {
    console.error("Error streaming from LLM:", error);

    const errorMessage = this.getErrorMessage(error);
    this.sendErrorMessage(messageId, errorMessage);
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "An unexpected error occurred. Please try again.";
    }

    const message = error.message.toLowerCase();

    if (message.includes("401") || message.includes("unauthorized")) {
      return "Authentication error: Please check your API key in the .env file.";
    }

    if (message.includes("429") || message.includes("rate limit")) {
      return "Rate limit exceeded. Please try again in a few moments.";
    }

    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused")
    ) {
      return "Network error: Please check your internet connection.";
    }

    if (message.includes("timeout")) {
      return "Request timeout: The service took too long to respond. Please try again.";
    }

    return "Sorry, I encountered an error while processing your request. Please try again.";
  }

  private sendErrorMessage(messageId: string, errorMessage: string): void {
    this.sendStreamChunk(messageId, {
      content: errorMessage,
      isComplete: true,
    });
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", {
      messageId,
      content: chunk.content,
      isComplete: chunk.isComplete,
    });
  }
}
