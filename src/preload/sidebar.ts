import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  context?: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
  styleMode?: boolean;
  lockStyles?: boolean;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

// Sidebar specific APIs
const sidebarAPI = {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) =>
    electronAPI.ipcRenderer.invoke("sidebar-chat-message", request),

  clearChat: () => electronAPI.ipcRenderer.invoke("sidebar-clear-chat"),

  getMessages: () => electronAPI.ipcRenderer.invoke("sidebar-get-messages"),

  onChatResponse: (callback: (data: ChatResponse) => void) => {
    electronAPI.ipcRenderer.on("chat-response", (_, data) => callback(data));
  },

  onMessagesUpdated: (callback: (messages: any[]) => void) => {
    electronAPI.ipcRenderer.on("chat-messages-updated", (_, messages) =>
      callback(messages)
    );
  },

  removeChatResponseListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-response");
  },

  removeMessagesUpdatedListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-messages-updated");
  },

  // Page content access
  getPageContent: () => electronAPI.ipcRenderer.invoke("get-page-content"),
  getPageText: () => electronAPI.ipcRenderer.invoke("get-page-text"),
  getCurrentUrl: () => electronAPI.ipcRenderer.invoke("get-current-url"),

  // Styles
  clearStyleInjection: () => electronAPI.ipcRenderer.invoke("clear-style-injection"),

  // Tab information
  getActiveTabInfo: () => electronAPI.ipcRenderer.invoke("get-active-tab-info"),

  // Autonomous agent
  startAgentTask: (payload: { goal: string; context?: Record<string, unknown> }) =>
    electronAPI.ipcRenderer.invoke("agent-start-task", payload),
  getAgentTasks: () => electronAPI.ipcRenderer.invoke("agent-get-tasks"),
  getAgentTask: (taskId: string) =>
    electronAPI.ipcRenderer.invoke("agent-get-task", taskId),
  getAgentTools: () => electronAPI.ipcRenderer.invoke("agent-get-tools"),
  subscribeAgentEvents: (
    callback: (event: { type: string; payload: any }) => void
  ): (() => void) => {
    const listener = (_: unknown, message: { type: string; payload: any }) =>
      callback(message);
    electronAPI.ipcRenderer.on("agent:event", listener);
    electronAPI.ipcRenderer.send("agent-subscribe");
    return () => {
      electronAPI.ipcRenderer.removeListener("agent:event", listener);
    };
  },
  removeAgentEventsListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("agent:event");
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("sidebarAPI", sidebarAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.sidebarAPI = sidebarAPI;
}
