import workerPath from './font-metadata-worker?modulePath'
import { MediaProcessPool } from './process-pool'

export const fontMetadataProcesses = new MediaProcessPool(workerPath, 2)
