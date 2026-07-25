import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { MediaTask, TaskKind, TaskStatus } from '../../shared/types'

interface StoredTaskHistory {
  version: 1
  tasks: MediaTask[]
}

const TASK_KINDS = new Set<TaskKind>(['video', 'image'])
const TASK_STATUSES = new Set<TaskStatus>([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])

export class TaskHistoryStore {
  private readonly path: string

  constructor(userDataPath: string) {
    this.path = join(userDataPath, 'tasks.json')
  }

  read(): MediaTask[] {
    try {
      const stored = JSON.parse(readFileSync(this.path, 'utf8')) as StoredTaskHistory
      if (stored.version !== 1 || !Array.isArray(stored.tasks)) return []
      return stored.tasks.filter(isStoredTask).map((task) => structuredClone(task))
    } catch {
      return []
    }
  }

  write(tasks: MediaTask[]): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    const stored: StoredTaskHistory = { version: 1, tasks }
    writeFileSync(temporaryPath, JSON.stringify(stored, null, 2), 'utf8')
    renameSync(temporaryPath, this.path)
  }
}

function isStoredTask(value: unknown): value is MediaTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<MediaTask>
  return (
    typeof task.id === 'string' &&
    TASK_KINDS.has(task.kind as TaskKind) &&
    typeof task.sourcePath === 'string' &&
    typeof task.outputPath === 'string' &&
    TASK_STATUSES.has(task.status as TaskStatus) &&
    typeof task.sourceSize === 'number' &&
    typeof task.createdAt === 'string' &&
    Boolean(task.options && typeof task.options === 'object')
  )
}
