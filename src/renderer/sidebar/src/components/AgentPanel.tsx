import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Play, Rocket, CheckCircle2, XCircle, Activity, Compass } from 'lucide-react'
import { useChat } from '../contexts/ChatContext'
import { cn } from '@common/lib/utils'
import { Button } from '@common/components/Button'

type AgentTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed'

interface AgentAction {
  type: string
  params: Record<string, unknown>
}

interface AgentStep {
  id: string
  index: number
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  modelThought?: string
  observation?: {
    result: 'success' | 'error'
    message: string
    data?: Record<string, unknown>
  }
  action?: AgentAction
  createdAt: number
  updatedAt: number
}

interface AgentTask {
  id: string
  goal: string
  status: AgentTaskStatus
  summary?: string
  steps: AgentStep[]
  createdAt: number
  updatedAt: number
  context?: Record<string, unknown>
  lastError?: string
}

interface AgentEventMessage {
  type: string
  payload: any
}

interface TaskLogEntry {
  id: string
  type: string
  label: string
  timestamp: number
  detail?: string
}

const statusStyles: Record<AgentTaskStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200',
  succeeded: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-200'
}

const statusIcon: Record<AgentTaskStatus, React.ReactNode> = {
  pending: <Activity className="h-4 w-4" />,
  running: <Loader2 className="h-4 w-4 animate-spin" />,
  succeeded: <CheckCircle2 className="h-4 w-4" />,
  failed: <XCircle className="h-4 w-4" />
}

const MAX_CONTEXT_CHARS = 1200

const formatTimestamp = (value: number) => {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(value)
}

export const AgentPanel: React.FC = () => {
  const { getPageText, getCurrentUrl } = useChat()
  const [goal, setGoal] = useState('')
  const [tasks, setTasks] = useState<Record<string, AgentTask>>({})
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [logsByTask, setLogsByTask] = useState<Record<string, TaskLogEntry[]>>({})
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [tools, setTools] = useState<any[]>([])

  const activeTask = activeTaskId ? tasks[activeTaskId] : null

  const appendLog = useCallback((taskId: string, entry: TaskLogEntry) => {
    setLogsByTask(prev => {
      const existing = prev[taskId] ?? []
      return {
        ...prev,
        [taskId]: [...existing, entry]
      }
    })
  }, [])

  const handleEvent = useCallback((event: AgentEventMessage) => {
    if (event.type === 'snapshot') {
      const taskList: AgentTask[] = event.payload.tasks ?? []
      setTasks(
        taskList.reduce<Record<string, AgentTask>>((acc, task) => {
          acc[task.id] = task
          return acc
        }, {})
      )
      setTools(event.payload.tools ?? [])
      if (taskList.length > 0 && !activeTaskId) {
        setActiveTaskId(taskList[0].id)
      }
      return
    }

    if (!event.payload) return

    switch (event.type) {
      case 'task-created': {
        const task: AgentTask = event.payload.task
        setTasks(prev => ({ ...prev, [task.id]: task }))
        setActiveTaskId(task.id)
        appendLog(task.id, {
          id: `${task.id}-created-${Date.now()}`,
          type: 'task-created',
          label: 'Task created',
          timestamp: Date.now()
        })
        break
      }
      case 'task-started': {
        const taskId: string = event.payload.taskId
        setTasks(prev => {
          const current = prev[taskId]
          if (!current) return prev
          return { ...prev, [taskId]: { ...current, status: 'running', updatedAt: Date.now() } }
        })
        appendLog(taskId, {
          id: `${taskId}-started-${Date.now()}`,
          type: 'task-started',
          label: 'Execution started',
          timestamp: Date.now()
        })
        break
      }
      case 'planning-started': {
        const taskId: string = event.payload.taskId
        appendLog(taskId, {
          id: `${taskId}-plan-${Date.now()}`,
          type: 'planning-started',
          label: 'Thinking…',
          timestamp: Date.now()
        })
        break
      }
      case 'planning-finished': {
        const taskId: string = event.payload.taskId
        const thought: string = event.payload.thought
        appendLog(taskId, {
          id: `${taskId}-thought-${Date.now()}`,
          type: 'planning-finished',
          label: 'Thought recorded',
          detail: thought,
          timestamp: Date.now()
        })
        break
      }
      case 'step-created': {
        const { taskId, step } = event.payload as { taskId: string; step: AgentStep }
        setTasks(prev => {
          const task = prev[taskId]
          if (!task) return prev
          return {
            ...prev,
            [taskId]: {
              ...task,
              steps: [...task.steps, step],
              updatedAt: Date.now()
            }
          }
        })
        appendLog(taskId, {
          id: `${taskId}-step-${step.id}`,
          type: 'step-created',
          label: `Planned ${step.action?.type ?? 'action'}`,
          detail: step.modelThought,
          timestamp: Date.now()
        })
        break
      }
      case 'step-updated': {
        const { taskId, step } = event.payload as { taskId: string; step: AgentStep }
        setTasks(prev => {
          const task = prev[taskId]
          if (!task) return prev
          const steps = task.steps.map(existing => (existing.id === step.id ? step : existing))
          return {
            ...prev,
            [taskId]: {
              ...task,
              steps,
              updatedAt: Date.now()
            }
          }
        })
        appendLog(taskId, {
          id: `${taskId}-step-updated-${step.id}-${Date.now()}`,
          type: 'step-updated',
          label: `${step.status === 'succeeded' ? 'Completed' : 'Failed'} ${step.action?.type ?? 'step'}`,
          detail: step.observation?.message,
          timestamp: Date.now()
        })
        break
      }
      case 'task-completed': {
        const { taskId, summary } = event.payload as { taskId: string; summary: string }
        setTasks(prev => {
          const task = prev[taskId]
          if (!task) return prev
          return {
            ...prev,
            [taskId]: { ...task, status: 'succeeded', summary, updatedAt: Date.now() }
          }
        })
        appendLog(taskId, {
          id: `${taskId}-completed-${Date.now()}`,
          type: 'task-completed',
          label: 'Task completed',
          detail: summary,
          timestamp: Date.now()
        })
        break
      }
      case 'task-failed': {
        const { taskId, error } = event.payload as { taskId: string; error: string }
        setTasks(prev => {
          const task = prev[taskId]
          if (!task) return prev
          return {
            ...prev,
            [taskId]: { ...task, status: 'failed', lastError: error, updatedAt: Date.now() }
          }
        })
        appendLog(taskId, {
          id: `${taskId}-failed-${Date.now()}`,
          type: 'task-failed',
          label: 'Task failed',
          detail: error,
          timestamp: Date.now()
        })
        break
      }
      default:
        break
    }
  }, [appendLog, activeTaskId])

  useEffect(() => {
    const unsubscribe = window.sidebarAPI.subscribeAgentEvents(handleEvent)
    return () => {
      unsubscribe()
      window.sidebarAPI.removeAgentEventsListener()
    }
  }, [handleEvent])

  const sortedTasks = useMemo(() => {
    return Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt)
  }, [tasks])

  const activeLogs = activeTask ? logsByTask[activeTask.id] ?? [] : []

  const handleLaunch = useCallback(async () => {
    if (!goal.trim()) return
    setIsLaunching(true)
    setLaunchError(null)
    try {
      const activeTab = await window.sidebarAPI.getActiveTabInfo()
      const pageText = await getPageText()
      const url = (await getCurrentUrl()) ?? activeTab?.url ?? null
      const context = {
        tabId: activeTab?.id,
        url,
        pageTitle: activeTab?.title,
        pageDescription: pageText
          ? pageText.slice(0, MAX_CONTEXT_CHARS)
          : undefined
      }
      const { task } = await window.sidebarAPI.startAgentTask({
        goal: goal.trim(),
        context
      })
      if (task?.id) {
        setActiveTaskId(task.id)
        appendLog(task.id, {
          id: `${task.id}-launch-${Date.now()}`,
          type: 'launch',
          label: 'Launching task',
          detail: goal.trim(),
          timestamp: Date.now()
        })
      }
      setGoal('')
    } catch (error) {
      console.error('Failed to start agent task', error)
      setLaunchError(
        error instanceof Error ? error.message : 'Failed to start agent task.'
      )
    } finally {
      setIsLaunching(false)
    }
  }, [goal, appendLog, getCurrentUrl, getPageText])

  const renderStep = (step: AgentStep) => {
    return (
      <div key={step.id} className="rounded-lg border border-border/80 bg-muted/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Step {step.index + 1} • {formatTimestamp(step.createdAt)}
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs',
              statusStyles[step.status === 'failed' ? 'failed' : step.status === 'succeeded' ? 'succeeded' : 'running']
            )}
          >
            {statusIcon[step.status === 'failed' ? 'failed' : step.status === 'succeeded' ? 'succeeded' : 'running']}
            <span className="capitalize">{step.status}</span>
          </div>
        </div>
        {step.action && (
          <div className="text-sm font-medium text-foreground">
            {step.action.type}
          </div>
        )}
        {step.modelThought && (
          <div className="text-sm text-muted-foreground">
            {step.modelThought}
          </div>
        )}
        {step.observation && (
          <div className="rounded-md bg-background/60 border border-border/70 p-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Observation
            </div>
            <div className="text-sm text-foreground">
              {step.observation.message}
            </div>
            {step.observation.data && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                {JSON.stringify(step.observation.data, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border/80 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Rocket className="h-4 w-4 text-primary" />
          <span className="font-medium text-foreground">Autonomous Agent</span>
          <span className="text-xs rounded-full border border-border px-2 py-0.5">
            {sortedTasks.length} runs
          </span>
        </div>
        <div className="flex gap-2">
          <input
            value={goal}
            onChange={event => setGoal(event.target.value)}
            placeholder="Describe the goal you want the agent to achieve…"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button
            onClick={handleLaunch}
            disabled={!goal.trim() || isLaunching}
            className="inline-flex items-center gap-2"
          >
            {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run
          </Button>
        </div>
        {launchError && (
          <div className="text-xs text-rose-500">
            {launchError}
          </div>
        )}
        {tools.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {tools.map((tool) => (
              <span
                key={tool.name}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
              >
                <Compass className="h-3 w-3 text-primary" />
                {tool.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-3 p-4">
          {sortedTasks.map(task => (
            <button
              key={task.id}
              className={cn(
                'w-full rounded-xl border border-border/70 p-3 text-left transition-colors',
                activeTaskId === task.id ? 'border-primary/60 bg-primary/5' : 'hover:border-primary/30'
              )}
              onClick={() => setActiveTaskId(task.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {task.goal}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatTimestamp(task.createdAt)}
                  </div>
                </div>
                <div className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs', statusStyles[task.status])}>
                  {statusIcon[task.status]}
                  <span className="capitalize">{task.status}</span>
                </div>
              </div>
              {task.summary && (
                <div className="mt-2 text-sm text-muted-foreground">
                  {task.summary}
                </div>
              )}
              {task.lastError && task.status === 'failed' && (
                <div className="mt-2 text-sm text-rose-500">
                  {task.lastError}
                </div>
              )}
            </button>
          ))}
          {sortedTasks.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
              The agent keeps a memory of each autonomous run. Launch a new goal to see it in action.
            </div>
          )}
        </div>
      </div>

      {activeTask && (
        <div className="border-t border-border/80 bg-background/95">
          <div className="max-h-[320px] overflow-y-auto p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4 text-primary" />
              <span className="font-medium text-foreground">
                Execution trace ({activeTask.steps.length} steps)
              </span>
            </div>
            {activeTask.steps.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Waiting for the first step…
              </div>
            )}
            {activeTask.steps.map(renderStep)}
          </div>

          <div className="border-t border-border/60 max-h-[200px] overflow-y-auto p-4 space-y-3 bg-muted/40">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Event feed
            </div>
            {activeLogs.length === 0 && (
              <div className="text-xs text-muted-foreground">
                No events yet for this run.
              </div>
            )}
            {activeLogs.map(entry => (
              <div key={entry.id} className="rounded-lg bg-background/60 p-3 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{entry.label}</span>
                  <span>{formatTimestamp(entry.timestamp)}</span>
                </div>
                {entry.detail && (
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground/90">
                    {entry.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


