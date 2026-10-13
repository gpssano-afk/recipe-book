import type { ImageAsset } from '../../src/domain/types'

export const tinyPng = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlYwAAAAASUVORK5CYII=', 'base64'))
export function screenshot(recipeId: string): ImageAsset {
  const blob = new Blob([tinyPng], { type: 'image/png' })
  return { id: crypto.randomUUID(), recipeId, kind: 'screenshot', mime: 'image/png', width: 1, height: 1, byteLength: blob.size, blob, thumbnail: null, createdAt: '2026-01-01T00:00:00.000Z' }
}
