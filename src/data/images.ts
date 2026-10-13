import type { ImageAsset, Recipe } from '../domain/types'
import { imageLimits, inspectBlob, validateImageAsset } from '../domain/images'
import { getDatabase } from './database'
import { DataError, storageError } from './errors'

export async function readRecipeImages(recipe: Recipe): Promise<ImageAsset[]> {
  try {
    const db = await getDatabase()
    const tx = db.transaction('images', 'readonly')
    const records = await tx.store.index('recipeId').getAll(recipe.id); await tx.done
    if (records.length !== recipe.imageIds.length) throw new DataError('invalid', '写真の参照が一致しません。元データを保持したまま編集を停止しました。')
    return await Promise.all(recipe.imageIds.map(async id => {
      const image = records.find(item => item.id === id)
      if (!image || image.recipeId !== recipe.id) throw new DataError('invalid', '写真を読み込めません。元データを保持したまま編集を停止しました。')
      return validateImageAsset(image)
    }))
  } catch (error) { throw storageError(error) }
}
export async function readImage(id: string, recipeId: string, thumbnail: boolean) {
  try {
    const db = await getDatabase(); const image = await db.get('images', id)
    if (!image || image.recipeId !== recipeId || !['dish', 'screenshot'].includes(image.kind) || (thumbnail && (image.kind !== 'dish' || !image.thumbnail))) throw new DataError('missing', '写真を読み込めません。')
    const binary = thumbnail ? image.thumbnail! : image
    const header = await inspectBlob(binary.blob, thumbnail ? imageLimits.thumbnailBytes : imageLimits.storedBytes)
    if (header.mime !== binary.mime || header.width !== binary.width || header.height !== binary.height || binary.byteLength !== binary.blob.size || Math.max(header.width, header.height) > (thumbnail ? 320 : image.kind === 'dish' ? 1600 : 2560)) throw new DataError('invalid', '写真の形式が正しくありません。')
    // 一覧は本体を復号せず、表示する表紙のサムネイルだけを返す。
    return { blob: thumbnail ? image.thumbnail!.blob : image.blob, kind: image.kind }
  } catch (error) { throw storageError(error) }
}
