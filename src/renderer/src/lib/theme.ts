import type { InjectionKey, Ref } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'

export const themeModeKey: InjectionKey<Ref<ThemeMode>> = Symbol('themeMode')
