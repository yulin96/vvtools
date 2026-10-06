import sharp from './sharp-runtime'
import type { MediaTask } from '../../shared/types'
import { processFailure } from './errors'
import { processImageCore } from './image-processor-core'

process.on('message', async (task: MediaTask) => {
  try {
    sharp.concurrency(task.processingThreads ?? 2)
    const result = await processImageCore(task, new AbortController().signal, (progress) =>
      process.send?.({ progress })
    )
    process.send?.({ ok: true, result })
  } catch (error) {
    process.send?.({ ok: false, ...processFailure(error) })
  }
})
