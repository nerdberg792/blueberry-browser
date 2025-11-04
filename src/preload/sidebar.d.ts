import { ElectronAPI } from "@electron-toolkit/preload";

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

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface SidebarAPI {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) => Promise<void>;
  clearChat: () => Promise<void>;
  getMessages: () => Promise<any[]>;
  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  removeChatResponseListener: () => void;
  onMessagesUpdated: (callback: (messages: any[]) => void) => void;
  removeMessagesUpdatedListener: () => void;

  // Page content access
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  // Styles
  clearStyleInjection: () => Promise<void>;

  // Tab information
  getActiveTabInfo: () => Promise<TabInfo | null>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}

