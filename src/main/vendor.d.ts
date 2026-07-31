declare module '@web-alchemy/fonttools' {
  export function subset(input: Uint8Array, options: Record<string, unknown>): Promise<Uint8Array>
  export function instantiateVariableFont(
    input: Uint8Array,
    options: Record<string, unknown>
  ): Promise<Uint8Array>
}
