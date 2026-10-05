import { createRenderer, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queueRoutedDrop, takeRoutedDrop } from '../lib/media-drop'
import { useWorkspaceDrop } from './useWorkspaceDrop'

const unmounts: Array<() => void> = []
const renderer = createRenderer<object, object>({
  patchProp: () => {},
  insert: () => {},
  remove: () => {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null
})

function mountDrop(...args: Parameters<typeof useWorkspaceDrop>): {
  dragging: Ref<boolean>
  unmount: () => void
} {
  let dragging!: Ref<boolean>
  const app = renderer.createApp({
    setup() {
      dragging = useWorkspaceDrop(...args)
      return () => null
    }
  })
  app.mount({})
  const unmount = (): void => app.unmount()
  unmounts.push(unmount)
  return { dragging, unmount }
}

function windowFixture(): EventTarget {
  const target = new EventTarget()
  const remove = target.removeEventListener.bind(target)
  // Node's EventTarget does not remove capture listeners with a boolean option.
  // Normalize the test window to the browser's equivalent capture semantics.
  target.removeEventListener = (type, listener, options) =>
    remove(type, listener, typeof options === 'boolean' ? { capture: options } : options)
  vi.stubGlobal(
    'window',
    Object.assign(target, {
      api: { getDroppedFilePath: (file: File & { path: string }) => file.path }
    })
  )
  return target
}

function dragEvent(
  type: string,
  paths: string[] = [],
  types = ['Files'],
  relatedTarget: object | null = null
): DragEvent {
  const event = new Event(type, { cancelable: true })
  Object.assign(event, {
    dataTransfer: { types, files: paths.map((path) => ({ path })), dropEffect: 'none' },
    relatedTarget
  })
  return event as DragEvent
}

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount()
  takeRoutedDrop('/font')
  vi.unstubAllGlobals()
})

describe('workspace drop lifecycle', () => {
  it('handles only file drags and preserves state when moving within the window', () => {
    const target = windowFixture()
    const receivePaths = vi.fn()
    const { dragging } = mountDrop(receivePaths)
    const textDrag = dragEvent('dragover', [], ['text/plain'])
    target.dispatchEvent(textDrag)
    target.dispatchEvent(dragEvent('drop', [], ['text/plain']))
    expect(textDrag.defaultPrevented).toBe(false)
    expect(dragging.value).toBe(false)
    expect(receivePaths).not.toHaveBeenCalled()

    const fileDrag = dragEvent('dragover')
    target.dispatchEvent(fileDrag)
    expect(fileDrag.defaultPrevented).toBe(true)
    expect(fileDrag.dataTransfer?.dropEffect).toBe('copy')
    expect(dragging.value).toBe(true)
    target.dispatchEvent(dragEvent('dragleave', [], ['Files'], {}))
    expect(dragging.value).toBe(true)
    target.dispatchEvent(dragEvent('dragleave'))
    expect(dragging.value).toBe(false)

    target.dispatchEvent(dragEvent('dragover'))
    const drop = dragEvent('drop', ['/tmp/first.ttf', '/tmp/second.otf'])
    target.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
    expect(dragging.value).toBe(false)
    expect(receivePaths).toHaveBeenCalledExactlyOnceWith(['/tmp/first.ttf', '/tmp/second.otf'])
  })

  it('removes capture listeners on actual component unmount', () => {
    const target = windowFixture()
    const add = vi.spyOn(target, 'addEventListener')
    const remove = vi.spyOn(target, 'removeEventListener')
    const receivePaths = vi.fn()
    const { dragging, unmount } = mountDrop(receivePaths)
    expect(add.mock.calls.map(([type, , capture]) => [type, capture])).toEqual([
      ['dragover', true],
      ['dragleave', true],
      ['drop', true]
    ])

    unmount()
    expect(remove.mock.calls.map(([type, , capture]) => [type, capture])).toEqual([
      ['dragover', true],
      ['dragleave', true],
      ['drop', true]
    ])
    target.dispatchEvent(dragEvent('dragover'))
    target.dispatchEvent(dragEvent('drop', ['/tmp/late.ttf']))
    expect(dragging.value).toBe(false)
    expect(receivePaths).not.toHaveBeenCalled()
    unmounts.splice(unmounts.indexOf(unmount), 1)
  })

  it('consumes routed files once through the workspace-specific handler', () => {
    windowFixture()
    queueRoutedDrop('/font', ['/tmp/first.ttf'])
    queueRoutedDrop('/font', ['/tmp/second.otf'])
    const dropped = vi.fn()
    const routed = vi.fn()
    mountDrop(dropped, { path: '/font', receivePaths: routed })

    expect(routed).toHaveBeenCalledExactlyOnceWith(['/tmp/first.ttf', '/tmp/second.otf'])
    expect(dropped).not.toHaveBeenCalled()
    expect(takeRoutedDrop('/font')).toEqual([])
  })
})
