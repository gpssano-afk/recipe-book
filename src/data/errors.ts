export type DataErrorKind = 'storage' | 'quota' | 'conflict' | 'missing' | 'invalid' | 'limit' | 'blocked' | 'version'
export class DataError extends Error {
  constructor(public readonly kind: DataErrorKind, message: string) { super(message) }
}
export function storageError(error: unknown): DataError {
  if (error instanceof DataError) return error
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  if (name === 'QuotaExceededError') return new DataError('quota', '保存領域が足りません。不要なテスト用レシピを削除してから再試行してください。')
  if (name === 'VersionError') return new DataError('version', 'データベースは新しい版で更新されています。アプリを更新してください。')
  return new DataError('storage', 'データを読み書きできませんでした。ブラウザの保存設定を確認して再試行してください。既存データは自動削除しません。')
}
