import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { AddressInfo } from "net";
import { WebSocketServer, WebSocket } from "ws";
import { AgentRuntime } from "./AgentRuntime";
import { AgentTaskContext, HttpHandler } from "./types";

interface AgentServerOptions {
  port?: number;
  host?: string;
  runtimeConfig?: Parameters<typeof AgentRuntime>[0];
}

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export class AgentServer {
  private readonly runtime: AgentRuntime;
  private readonly options: AgentServerOptions;
  private server = createServer();
  private websocketServer: WebSocketServer | null = null;
  private running = false;
  private readonly routes = new Map<string, RouteHandler>();

  constructor(options?: AgentServerOptions) {
    this.options = options ?? {};
    this.runtime = new AgentRuntime(this.options.runtimeConfig);
    this.registerRoutes();
    this.bindRuntimeEvents();
  }

  getRuntime(): AgentRuntime {
    return this.runtime;
  }

  async start(): Promise<number> {
    if (this.running) {
      throw new Error("Agent server already running.");
    }
    this.server.on("request", this.handleRequest);
    const port = this.options.port ?? Number(process.env.AGENT_SERVER_PORT);
    const host = this.options.host ?? "127.0.0.1";
    await new Promise<void>((resolve) => {
      this.server.listen(port, host, resolve);
    });
    this.running = true;
    this.bootstrapWebSocket();
    const address = this.server.address() as AddressInfo;
    console.log(
      `🧠 Agent server listening on http://${address.address}:${address.port}`
    );
    return address.port;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (this.websocketServer) {
      this.websocketServer.close();
      this.websocketServer = null;
    }
    this.running = false;
  }

  private registerRoutes(): void {
    this.routes.set("GET /health", async (_req, res) => {
      this.json(res, { status: "ok" });
    });

    this.routes.set("GET /tools", async (_req, res) => {
      this.json(res, { tools: this.runtime.getTools() });
    });

    this.routes.set("GET /tasks", async (_req, res) => {
      this.json(res, { tasks: this.runtime.listTasks() });
    });

    this.routes.set("GET /tasks/:id", async (req, res) => {
      const id = this.extractParam(req.url ?? "", 2);
      const task = id ? this.runtime.getTask(id) : undefined;
      if (!task) {
        this.json(res, { error: "Task not found." }, 404);
        return;
      }
      this.json(res, { task });
    });

    this.routes.set("POST /tasks", async (req, res) => {
      try {
        const body = await this.readJson(req);
        const task = await this.runtime.createTask(
          String(body.goal ?? ""),
          body.context as AgentTaskContext | undefined
        );
        this.json(res, { task }, 201);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create task.";
        this.json(res, { error: message }, 400);
      }
    });
  }

  private bindRuntimeEvents(): void {
    this.runtime.on("task-created", (payload) =>
      this.broadcast({ type: "task-created", payload })
    );
    this.runtime.on("task-started", (payload) =>
      this.broadcast({ type: "task-started", payload })
    );
    this.runtime.on("step-created", (payload) =>
      this.broadcast({ type: "step-created", payload })
    );
    this.runtime.on("step-updated", (payload) =>
      this.broadcast({ type: "step-updated", payload })
    );
    this.runtime.on("task-completed", (payload) =>
      this.broadcast({ type: "task-completed", payload })
    );
    this.runtime.on("task-failed", (payload) =>
      this.broadcast({ type: "task-failed", payload })
    );
    this.runtime.on("planning-started", (payload) =>
      this.broadcast({ type: "planning-started", payload })
    );
    this.runtime.on("planning-finished", (payload) =>
      this.broadcast({ type: "planning-finished", payload })
    );
    this.runtime.on("task-error", (payload) =>
      this.broadcast({ type: "task-error", payload })
    );
  }

  private bootstrapWebSocket(): void {
    this.websocketServer = new WebSocketServer({
      server: this.server,
      path: "/events",
    });
    this.websocketServer.on("connection", (socket) => {
      const initial = {
        type: "snapshot",
        payload: { tasks: this.runtime.listTasks(), tools: this.runtime.getTools() },
      };
      socket.send(JSON.stringify(initial));
    });
  }

  private broadcast(message: unknown): void {
    if (!this.websocketServer) return;
    const serialised = JSON.stringify(message);
    for (const client of this.websocketServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialised);
      }
    }
  }

  private readonly handleRequest: HttpHandler = async (req, res) => {
    const key = `${req.method ?? "GET"} ${this.normalisePath(req.url ?? "/")}`;
    const handler = this.routes.get(key) ?? this.matchDynamicRoute(req);
    if (!handler) {
      this.json(res, { error: "Not found." }, 404);
      return;
    }
    try {
      await handler(req, res);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Agent server error.";
      this.json(res, { error: message }, 500);
    }
  };

  private matchDynamicRoute(req: IncomingMessage): RouteHandler | undefined {
    const method = req.method ?? "GET";
    const path = this.normalisePath(req.url ?? "/");
    for (const [key, handler] of this.routes.entries()) {
      if (!key.includes("/:")) continue;
      const [registeredMethod, registeredPath] = key.split(" ");
      if (registeredMethod !== method) continue;
      const pathParts = path.split("/").filter(Boolean);
      const registeredParts = registeredPath.split("/").filter(Boolean);
      if (pathParts.length !== registeredParts.length) continue;
      let match = true;
      for (let i = 0; i < pathParts.length; i++) {
        if (registeredParts[i]?.startsWith(":")) continue;
        if (registeredParts[i] !== pathParts[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        return handler;
      }
    }
    return undefined;
  }

  private normalisePath(path: string): string {
    const url = path.split("?")[0] ?? "/";
    if (url === "/") return url;
    return url.endsWith("/") ? url.slice(0, -1) : url;
  }

  private extractParam(path: string, index: number): string | undefined {
    const parts = this.normalisePath(path).split("/").filter(Boolean);
    return parts[index];
  }

  private async readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", resolve);
      req.on("error", reject);
    });
    if (chunks.length === 0) {
      return {};
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("Invalid JSON payload.");
    }
  }

  private json(res: ServerResponse, payload: unknown, status = 200): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }
}

export async function createAgentServer(options?: AgentServerOptions) {
  const server = new AgentServer(options);
  const port = await server.start();
  return { server, port };
}


