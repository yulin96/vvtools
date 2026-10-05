import type { InjectionKey, Ref } from 'vue'
import type { ThemeMode } from '../../../shared/types'
export type { ThemeMode } from '../../../shared/types'

export const themeModeKey: InjectionKey<Ref<ThemeMode>> = Symbol('themeMode')
