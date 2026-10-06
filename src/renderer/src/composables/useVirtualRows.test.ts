import { createRenderer, defineComponent, h, markRaw, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVirtualRows } from './useVirtualRows'

interface ElementFixture {
  clientHeight: number
  scrollTop: number
  parent: ElementFixture | null
  children: ElementFixture[]
}
const element = (): ElementFixture =>
  markRaw({
    clientHeight: 480,
    scrollTop: 0,
    parent: null,
    children: []
  })
const renderer = createRenderer<ElementFixture, ElementFixture>({
  createElement: element,
  createText: element,
  createComment: element,
  setText: () => {},
  setElementText: () => {},
  patchProp: () => {},
  insert(child, parent) {
    child.parent = parent
    parent.children.push(child)
  },
  remove(child) {
    if (child.parent) child.parent.children = child.parent.children.filter((item) => item !== child)
  },
  parentNode: (node) => node.parent,
  nextSibling: () => null
})

afterEach(() => vi.unstubAllGlobals())

describe('virtual row viewport lifecycle', () => {
  it('measures, batches scrolling, clamps shortened lists and cleans up on unmount', async () => {
    let resize!: ResizeObserverCallback
    let draw!: FrameRequestCallback
    const observe = vi.fn()
    const disconnect = vi.fn()
    const cancelFrame = vi.fn()
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      draw = callback
      return 12
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback
        }
        observe = observe
        disconnect = disconnect
      }
    )
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    const count = ref(500)
    let state!: ReturnType<typeof useVirtualRows>
    const app = renderer.createApp(
      defineComponent({
        setup() {
          state = useVirtualRows(count)
          return () => h('div', { ref: state.viewport })
        }
      })
    )
    const root = element()
    app.mount(root)
    try {
      expect(observe).toHaveBeenCalledWith(root.children[0])
      expect(state.range.value).toMatchObject({ start: 0, end: 16 })
      root.children[0].scrollTop = 4800
      state.onScroll()
      state.onScroll()
      expect(requestFrame).toHaveBeenCalledOnce()
      draw(0)
      expect(state.range.value).toMatchObject({ start: 94, end: 116 })
      root.children[0].clientHeight = 960
      resize([], {} as ResizeObserver)
      expect(state.range.value).toMatchObject({ start: 94, end: 126 })
      count.value = 3
      await nextTick()
      expect(root.children[0].scrollTop).toBe(0)
      expect(state.range.value).toEqual({ start: 0, end: 3, before: 0, after: 0 })
      state.onScroll()
    } finally {
      app.unmount()
    }
    expect(disconnect).toHaveBeenCalledOnce()
    expect(cancelFrame).toHaveBeenCalledWith(12)
  })
})
