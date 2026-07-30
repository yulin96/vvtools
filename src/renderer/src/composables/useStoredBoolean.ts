import { ref, watch, type Ref } from 'vue'

export function useStoredBoolean(key: string, fallback = false): Ref<boolean> {
  const stored = localStorage.getItem(key)
  const value = ref(stored === null ? fallback : stored === 'true')

  watch(value, (nextValue) => {
    localStorage.setItem(key, String(nextValue))
  })

  return value
}
