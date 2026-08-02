import type { MediaTask } from '../../../shared/types'

type TaskProgressState = Pick<MediaTask, 'status' | 'progress'>

export function taskProgressValue(task: TaskProgressState): number | null {
  if (task.status === 'completed') return 100
  if (task.status === 'pending' || task.status === 'cancelled') return 0
  return task.progress
}

export function taskProgressText(task: TaskProgressState): string {
  if (task.status === 'cancelled') return '—'
  const progress = taskProgressValue(task)
  return progress === null ? '—' : `${Math.round(progress)}%`
}
