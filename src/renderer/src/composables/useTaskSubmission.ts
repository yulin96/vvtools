import { toRef, type Ref } from 'vue'
import type { CreateTasksRequest, TaskKind } from '../../../shared/types'
import { useAppStore, type TaskSubmissionResult } from '../stores/app'

export function useTaskSubmission<T>(
  kind: TaskKind,
  pendingItems: Ref<T[]>,
  itemKey: (item: T) => string,
  handledKey: keyof TaskSubmissionResult = 'handledPaths'
): { starting: Ref<boolean>; submit: (request: CreateTasksRequest) => Promise<void> } {
  const store = useAppStore()
  const starting = toRef(store.submitting, kind)

  async function submit(request: CreateTasksRequest): Promise<void> {
    if (starting.value) return
    starting.value = true
    try {
      const previous = pendingItems.value.length
        ? store.currentBatchTasks[request.kind][0]
        : undefined
      const result = await store.submitTasks(
        previous ? { ...request, continueBatchTaskId: previous.id } : request
      )
      if (!result) return
      const handled = new Set(result[handledKey])
      pendingItems.value = pendingItems.value.filter((item) => !handled.has(itemKey(item)))
    } finally {
      starting.value = false
    }
  }

  return { starting, submit }
}
