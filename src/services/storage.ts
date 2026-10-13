export interface StorageStatus { usage: number | null; quota: number | null; persisted: boolean | null; canRequest: boolean }
export async function readStorageStatus(): Promise<StorageStatus> {
  const storage = navigator.storage
  let usage: number | null = null; let quota: number | null = null; let persisted: boolean | null = null
  if (storage?.estimate) {
    try { const estimate = await storage.estimate(); usage = Number.isFinite(estimate.usage) ? estimate.usage! : null; quota = Number.isFinite(estimate.quota) ? estimate.quota! : null } catch { /* unknown, never display zero */ }
  }
  if (storage?.persisted) { try { persisted = await storage.persisted() } catch { /* unknown */ } }
  return { usage, quota, persisted, canRequest: typeof storage?.persist === 'function' }
}
export const formatBytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(2)} MiB`
