import { ref, type Ref } from 'vue'
import type { CreateTasksRequest } from '../../../shared/types'
import { useAppStore, type TaskSubmissionResult } from '../stores/app'

export function useTaskSubmission<T>(
  pendingItems: Ref<T[]>,
  itemKey: (item: T) => string,
  handledKey: keyof TaskSubmissionResult = 'handledPaths'
): { starting: Ref<boolean>; submit: (request: CreateTasksRequest) => Promise<void> } {
  const store = useAppStore()
  const starting = ref(false)

  async function submit(request: CreateTasksRequest): Promise<void> {
    if (starting.value) return
    starting.value = true
    try {
      const result = await store.submitTasks(request)
      if (!result) return
      const handled = new Set(result[handledKey])
      pendingItems.value = pendingItems.value.filter((item) => !handled.has(itemKey(item)))
    } finally {
      starting.value = false
    }
  }

  return { starting, submit }
}
