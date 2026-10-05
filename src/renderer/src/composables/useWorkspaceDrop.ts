import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { takeRoutedDrop, type MediaWorkspacePath } from '../lib/media-drop'

type ReceivePaths = (paths: string[]) => void | Promise<void>

export function useWorkspaceDrop(
  receivePaths: ReceivePaths,
  routedDrop?: { path: MediaWorkspacePath; receivePaths: ReceivePaths }
): Ref<boolean> {
  const dragging = ref(false)

  function hasFiles(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes('Files')
  }

  function handleDragOver(event: DragEvent): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    dragging.value = true
  }

  function handleDragLeave(event: DragEvent): void {
    if (!event.relatedTarget) dragging.value = false
  }

  function handleDrop(event: DragEvent): void {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragging.value = false
    const paths = [...(event.dataTransfer?.files ?? [])].map((file) =>
      window.api.getDroppedFilePath(file)
    )
    void receivePaths(paths)
  }

  onMounted(() => {
    window.addEventListener('dragover', handleDragOver, true)
    window.addEventListener('dragleave', handleDragLeave, true)
    window.addEventListener('drop', handleDrop, true)
    if (routedDrop) void routedDrop.receivePaths(takeRoutedDrop(routedDrop.path))
  })

  onBeforeUnmount(() => {
    window.removeEventListener('dragover', handleDragOver, true)
    window.removeEventListener('dragleave', handleDragLeave, true)
    window.removeEventListener('drop', handleDrop, true)
  })

  return dragging
}
