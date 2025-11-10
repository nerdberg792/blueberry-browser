import { app, BrowserWindow } from "electron";
import { electronApp } from "@electron-toolkit/utils";
import { Window } from "./Window";
import { AgentBridge } from "./AgentBridge";
import { AppMenu } from "./Menu";
import { EventManager } from "./EventManager";
import { createAgentExecutor } from "./AgentExecutor";

let mainWindow: Window | null = null;
let eventManager: EventManager | null = null;
let menu: AppMenu | null = null;
let agentBridge: AgentBridge | null = null;

const createWindow = (): Window => {
  const window = new Window();
  agentBridge = new AgentBridge(window);
  agentBridge.registerExecutor(createAgentExecutor(window));
  void agentBridge.start().catch((error) => {
    console.error("Failed to start agent bridge:", error);
  });
  menu = new AppMenu(window);
  eventManager = new EventManager(window, agentBridge);
  return window;
};

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.electron");

  mainWindow = createWindow();

  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (eventManager) {
    eventManager.cleanup();
    eventManager = null;
  }

  // Clean up references
  if (mainWindow) {
    mainWindow = null;
  }
  if (menu) {
    menu = null;
  }
  if (agentBridge) {
    void agentBridge.stop().catch((error) => {
      console.error("Failed to stop agent bridge:", error);
    });
    agentBridge = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
