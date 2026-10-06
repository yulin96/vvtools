import sharp from 'sharp'

// Cached file loaders can retain Windows handles after a completed operation.
sharp.cache(false)

export default sharp
