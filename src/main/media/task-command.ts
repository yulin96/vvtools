import { basename } from 'path'
import type { TaskCommand } from '../../shared/types'

function quote(value: string): string {
  if (!/[\s"']/u.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}

export function createTaskCommand(executable: string, args: string[]): TaskCommand {
  return {
    executable,
    args: [...args],
    display: [quote(basename(executable)), ...args.map(quote)].join(' ')
  }
}
