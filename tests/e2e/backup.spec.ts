import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackupV1 } from '../../src/domain/backup'
import type { ImageAsset, Recipe } from '../../src/domain/types'

const instant = '2026-01-01T00:00:00.000Z'
function emptyBackup(): BackupV1 { return { format: 'sano-gohan-backup', formatVersion: 1, exportedAt: instant, recipes: [], images: [], mealDecisions: [], cookingLogs: [] } }
function recipe(title = '架空の復元料理'): Recipe {
  return { id: crypto.randomUUID(), title, category: 'main', ingredients: [{ name: '架空食材', amount: '適量' }], servings: 3, steps: ['混ぜる'], cookingMinutes: 20, memo: '架空のメモ', tags: ['和食', '定番'], sourceUrl: 'https://example.com/recipe', isFavorite: true, imageIds: [], coverImageId: null, createdAt: instant, updatedAt: instant, revision: 3 }
}
async function backupFixture(page: Page) {
  const backup = { ...emptyBackup(), recipes: [recipe()] }
  const binaries = await page.evaluate(() => {
    const canvas = document.createElement('canvas');canvas.width = 240;canvas.height = 120
    const context = canvas.getContext('2d')!;context.fillStyle = '#94432e';context.fillRect(0, 0, 240, 120)
    context.fillStyle = '#fff';context.font = '20px sans-serif';context.fillText('Test recipe', 15, 65)
    return ['image/jpeg', 'image/png', 'image/webp'].map(mime => { const base64 = canvas.toDataURL(mime).split(',')[1]!;return { mime: mime as ImageAsset['mime'], width: 240, height: 120, byteLength: atob(base64).length, base64 } })
  })
  const id = backup.recipes[0]!.id
  backup.images = binaries.map((original, index) => ({ id: crypto.randomUUID(), recipeId: id, kind: index === 0 ? 'dish' : 'screenshot', createdAt: instant, original, thumbnail: index === 0 ? { ...original } : null }))
  backup.recipes[0]!.imageIds = [backup.images[2]!.id, backup.images[0]!.id, backup.images[1]!.id]
  backup.recipes[0]!.coverImageId = backup.images[0]!.id
  backup.mealDecisions = [{ id: crypto.randomUUID(), recipeId: id, recipeTitleSnapshot: '当時の名前', categorySnapshot: 'side', decidedAt: instant }]
  backup.cookingLogs = [{ id: crypto.randomUUID(), recipeId: id, decisionId: backup.mealDecisions[0]!.id, cookedOn: '2024-02-29', memo: '架空の記録', createdAt: instant, updatedAt: instant, revision: 2 }]
  return backup
}
async function settings(page: Page) { await page.goto('#/settings');await expect(page.getByRole('button', { name: '復元ファイルを選ぶ', exact: true })).toBeEnabled() }
async function preview(page: Page, backup: unknown) {
  const json = JSON.stringify(backup)
  let directory: string | undefined
  try {
    const input = page.getByLabel('復元するバックアップファイル', { exact: true })
    if (Buffer.byteLength(json) > 50 * 1024 ** 2) {
      directory = await mkdtemp(join(tmpdir(), 'recipe-backup-fixture-'))
      const path = join(directory, 'large-test.json');await writeFile(path, json)
      await input.setInputFiles(path)
    } else await input.setInputFiles({ name: 'test-backup.json', mimeType: 'application/json', buffer: Buffer.from(json) })
    await expect(page.getByRole('heading', { name: '復元内容の確認', exact: true })).toBeVisible({ timeout: 60000 })
  } finally { if (directory) await rm(directory, { recursive: true, force: true }) }
}
async function restore(page: Page, backup: unknown) {
  await preview(page, backup)
  await page.getByLabel('バックアップ済み、または全件置換を理解しました').check()
  await page.getByRole('button', { name: '置き換えて復元', exact: true }).click()
  await expect(page.getByText('バックアップを復元しました。', { exact: true })).toBeVisible()
}
async function exportFile(page: Page, name = 'バックアップを書き出す') {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const file = await downloaded
  expect(file.suggestedFilename()).toMatch(/^sano-gohan-backup-\d{8}-\d{6}\.json$/)
  await expect(page.getByText('書き出しを開始しました。保存先のファイルを確認し、端末の外に保管してください。', { exact: true })).toBeVisible()
  return JSON.parse(await readFile((await file.path())!, 'utf8')) as BackupV1
}
async function dbSnapshot(page: Page) {
  return page.evaluate(async () => {
    const snapshot = await new Promise<Record<string, unknown[]>>((resolve, reject) => {
      const request = indexedDB.open('sano-recipe-book', 1)
      request.onerror = () => reject(new Error('test open failed'))
      request.onsuccess = () => {
        const db = request.result;const names = ['recipes', 'images', 'mealDecisions', 'cookingLogs', 'meta'];const tx = db.transaction(names)
        const result: Record<string, unknown[]> = {}
        for (const name of names) { const read = tx.objectStore(name).getAll();read.onsuccess = () => { result[name] = read.result } }
        tx.oncomplete = () => { db.close();resolve(result) };tx.onerror = () => reject(new Error('test read failed'))
      }
    })
    const binary = async (blob: Blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());const parts: string[] = []
      for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
      return btoa(parts.join(''))
    }
    snapshot.images = await Promise.all((snapshot.images as ImageAsset[]).map(async image => ({ ...image, blob: await binary(image.blob), thumbnail: image.thumbnail && { ...image.thumbnail, blob: await binary(image.thumbnail.blob) } })))
    return snapshot
  })
}
const comparable = (backup: BackupV1) => ({ ...backup, exportedAt: instant })

test('T14: 全種と3形式の写真を復元・表示・再読み込み・再出力。空の別ブラウザにも復元', async ({ page, browser }) => {
  const errors: string[] = [];page.on('pageerror', error => errors.push(error.message))
  await settings(page);const original = await backupFixture(page)
  await restore(page, original)
  await page.goto(`#/recipes/${original.recipes[0]!.id}`)
  await expect(page.locator('.detail-gallery img')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '架空の復元料理を定番から外す', exact: true })).toBeVisible()
  await page.reload();await expect(page.getByRole('heading', { name: '架空の復元料理', exact: true })).toBeVisible()
  await settings(page);const output = await exportFile(page)
  // IDBのキー順とファイル入力順は異なるため、配列をIDで比較する。
  const normalized = (b: BackupV1) => ({ ...comparable(b), images: [...b.images].sort((a, b) => a.id.localeCompare(b.id)) })
  expect(normalized(output)).toEqual(normalized(original))
  const context = await browser.newContext();const other = await context.newPage()
  try {
    await other.goto('http://127.0.0.1:4173/recipe-book/#/settings');await expect(other.getByRole('button', { name: '復元ファイルを選ぶ', exact: true })).toBeEnabled()
    await restore(other, output);await settings(other);expect(normalized(await exportFile(other))).toEqual(normalized(original))
  } finally { await context.close() }
  expect(errors).toEqual([])
})

test('T15: 確認なし・キャンセルで不変。空ファイルも明示確認後に全件置換', async ({ page }) => {
  await settings(page);const backup = await backupFixture(page);await restore(page, backup);await settings(page)
  const before = await dbSnapshot(page)
  await preview(page, emptyBackup())
  await expect(page.getByRole('button', { name: '置き換えて復元', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '復元をキャンセル', exact: true }).click()
  expect(await dbSnapshot(page)).toEqual(before)
  await restore(page, emptyBackup());await settings(page)
  expect((await exportFile(page)).recipes).toEqual([])
})

test('T15: 別タブ更新後は件数の再確認と再チェックが必要、復元後の一覧条件は初期化', async ({ page, context }) => {
  await page.goto('#/recipes');await page.getByLabel('レシピを検索').fill('条件は破棄する')
  await settings(page);const backup = await backupFixture(page);await preview(page, backup)
  await page.getByLabel('バックアップ済み、または全件置換を理解しました').check()
  const other = await context.newPage();await other.goto('http://127.0.0.1:4173/recipe-book/#/recipes/new')
  await other.getByLabel('料理名').fill('別タブの架空料理');await other.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(page.getByRole('button', { name: '現在の件数を再確認', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '置き換えて復元', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '現在の件数を再確認', exact: true }).click()
  await expect(page.getByLabel('バックアップ済み、または全件置換を理解しました')).not.toBeChecked()
  await page.getByLabel('バックアップ済み、または全件置換を理解しました').check();await page.getByRole('button', { name: '置き換えて復元', exact: true }).click()
  await expect(page.getByText('バックアップを復元しました。', { exact: true })).toBeVisible()
  await page.goto('#/recipes');await expect(page.getByLabel('レシピを検索')).toHaveValue('')
  await expect(page.getByRole('heading', { name: '架空の復元料理', exact: true })).toBeVisible();await other.close()
})

for (const failure of ['quota', 'abort'] as const) test(`T16: 復元のclear後の${failure}で全storeと写真のバイトを保全`, async ({ page }) => {
  await settings(page);await restore(page, await backupFixture(page));await settings(page)
  const before = await dbSnapshot(page);const replacement = await backupFixture(page);replacement.recipes[0]!.title = '置換失敗用'
  await preview(page, replacement)
  await page.evaluate(failure => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'images') { if (failure === 'abort') this.transaction.abort();else throw new DOMException('injected', 'QuotaExceededError') }
      return key === undefined ? put.call(this, value) : put.call(this, value, key)
    }
  }, failure)
  await page.getByLabel('バックアップ済み、または全件置換を理解しました').check();await page.getByRole('button', { name: '置き換えて復元', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('復元を完了できませんでした')
  expect(await dbSnapshot(page)).toEqual(before)
})

test('T17: 不正ファイル・未来版・HTML・画像復号失敗で不変、外部送信なし', async ({ page }) => {
  await settings(page);await restore(page, await backupFixture(page));await settings(page)
  const before = await dbSnapshot(page);const backup = await backupFixture(page)
  const future = { ...backup, formatVersion: 2 }
  const wrongDimension = structuredClone(backup);wrongDimension.images[0]!.original.width = 241
  const brokenImage = structuredClone(backup);const bytes = Buffer.from(brokenImage.images[1]!.original.base64, 'base64');bytes.fill(0, 50, bytes.length - 12);brokenImage.images[1]!.original.base64 = bytes.toString('base64')
  const outside: string[] = [];page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173') && !request.url().startsWith('blob:')) outside.push(request.url()) })
  for (const data of ['{broken', JSON.stringify(future), JSON.stringify(wrongDimension), JSON.stringify(brokenImage), '{"__proto__":{}}']) {
    await page.getByLabel('復元するバックアップファイル', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(data) })
    await expect(page.getByRole('alert')).toContainText('既存データは変更していません');await expect(page.getByRole('heading', { name: '復元内容の確認', exact: true })).toHaveCount(0)
    expect(await dbSnapshot(page)).toEqual(before)
  }
  const literal = structuredClone(backup);literal.recipes[0]!.title = '<img src="https://example.com/never-requested" onerror="alert(1)">'
  await restore(page, literal);await page.goto(`#/recipes/${literal.recipes[0]!.id}`)
  await expect(page.getByRole('heading', { name: literal.recipes[0]!.title, exact: true })).toBeVisible()
  await expect(page.locator('img[src^="https://example.com"]')).toHaveCount(0)
  expect(outside).toEqual([])
})

test('T18: 生成中の別タブ更新は旧スナップショットのみ。URLは離脱時に解放', async ({ page, context }) => {
  await page.clock.install()
  await settings(page);const backup = await backupFixture(page);await restore(page, backup);await settings(page)
  await page.evaluate(() => {
    const decode = window.createImageBitmap
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => { await new Promise(resolve => setTimeout(resolve, 700));return decode(source, options) }) as typeof createImageBitmap
    const create = URL.createObjectURL;const revoke = URL.revokeObjectURL;const active = new Set<string>()
    URL.createObjectURL = blob => { const url = create(blob);if (blob instanceof Blob && blob.type === 'application/json') active.add(url);return url };URL.revokeObjectURL = url => { active.delete(url);revoke(url) }
    Object.assign(window, { testActiveBackupUrls: active })
  })
  const downloading = page.waitForEvent('download');await page.getByRole('button', { name: 'バックアップを書き出す', exact: true }).click()
  await page.getByRole('link', { name: 'ホーム', exact: true }).click();expect(page.url()).toContain('#/settings')
  const other = await context.newPage();await other.goto('http://127.0.0.1:4173/recipe-book/#/recipes/new');await other.getByLabel('料理名').fill('生成中に追加');await other.getByRole('button', { name: '保存する', exact: true }).click()
  const downloaded = await downloading;const output = JSON.parse(await readFile((await downloaded.path())!, 'utf8')) as BackupV1
  expect(output.recipes).toHaveLength(1)
  await expect(page.getByText('書き出しを開始しました。保存先のファイルを確認し、端末の外に保管してください。', { exact: true })).toBeVisible()
  const snapshot = await dbSnapshot(page);expect(snapshot.meta![0]).toMatchObject({ dataRevision: 2, lastExportRevision: 1 })
  // 30秒後の自動解放で離脱時のcleanup漏れを隠さない。
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  const activeBackupUrlCount = () => page.evaluate(() => (window as unknown as { testActiveBackupUrls: Set<string> }).testActiveBackupUrls.size)
  expect(await activeBackupUrlCount()).toBe(1)
  await page.getByRole('link', { name: 'ホーム', exact: true }).click()
  await expect(page).toHaveURL(/\/recipe-book\/#\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('今日のごはんをわが家のレシピから。')
  // hashの更新・クリック完了だけではReactの画面切替とeffect cleanupは完了しない。
  await expect.poll(activeBackupUrlCount).toBe(0)
  await other.close()
})

test('T18: 初回の消失案内を確認、未出力の案内は閉じられる', async ({ page }) => {
  await page.goto('#/recipes/new');await page.getByLabel('料理名').fill('案内テスト');await page.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(page.getByText('保存したレシピについて', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '確認しました', exact: true }).click();await page.reload()
  await expect(page.getByText('保存したレシピについて', { exact: true })).toHaveCount(0)
  await page.goto('#/');await expect(page.getByText('レシピを端末の外にも保管しましょう', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '案内を閉じる', exact: true }).click();await expect(page.getByText('レシピを端末の外にも保管しましょう', { exact: true })).toHaveCount(0)
})

for (const width of [320, 360, 390, 430]) test(`T23: 設定と復元確認 ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 740 });await settings(page);await preview(page, await backupFixture(page))
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const buttons = await page.locator('button:visible').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect();return { width: box.width, height: box.height } }))
  for (const button of buttons) { expect(button.width).toBeGreaterThanOrEqual(48);expect(button.height).toBeGreaterThanOrEqual(48) }
  await page.getByRole('button', { name: '復元をキャンセル', exact: true }).click()
})

test('T18/R14: 容量API非対応と永続保存拒否でも空バックアップ・復元を利用可能', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined }) })
  await settings(page);await expect(page.getByText('このブラウザでは永続保存の許可を要求できません。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '永続保存の許可をリクエスト', exact: true })).toBeDisabled()
  expect((await exportFile(page)).recipes).toEqual([])
  await restore(page, emptyBackup())
})

test('R14: 永続保存の拒否・例外・許可はバックアップの代わりと表示しない', async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 90, quota: 100 }), persisted: async () => false, persist: async () => { calls++;if (calls === 2) throw new Error('injected');return calls > 2 } } })
  })
  await settings(page);await expect(page.getByText(/保存容量が上限に近づいています/)).toBeVisible()
  const button = page.getByRole('button', { name: '永続保存の許可をリクエスト', exact: true })
  await button.click();await expect(page.getByText(/永続保存は許可されませんでした/)).toBeVisible()
  await button.click();await expect(page.getByRole('alert')).toContainText('引き続き利用できます')
  await button.click();await expect(page.getByText(/永続保存の許可が得られました。データ消失を防ぐ保証はありません/)).toBeVisible()
})

test('T15: 画像検証中のキャンセル・離脱はDB不変', async ({ page }) => {
  await settings(page);const backup = await backupFixture(page);await restore(page, backup);await settings(page)
  const before = await dbSnapshot(page)
  await page.evaluate(() => {
    const decode = window.createImageBitmap
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => { await new Promise(resolve => setTimeout(resolve, 300));return decode(source, options) }) as typeof createImageBitmap
  })
  await page.getByLabel('復元するバックアップファイル', { exact: true }).setInputFiles({ name: 'cancel.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('button', { name: '検証をキャンセル', exact: true }).click()
  await expect(page.getByRole('button', { name: '復元ファイルを選ぶ', exact: true })).toBeEnabled()
  expect(await dbSnapshot(page)).toEqual(before)
  await page.getByLabel('復元するバックアップファイル', { exact: true }).setInputFiles({ name: 'leave.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('link', { name: 'ホーム', exact: true }).click()
  await expect(page.getByRole('heading', { name: '架空の復元料理', exact: true }).first()).toBeVisible()
  expect(await dbSnapshot(page)).toEqual(before)
})

test('T18: ファイル生成失敗と要求記録失敗を区別しデータ不変', async ({ page }) => {
  await settings(page);const backup = await backupFixture(page);await restore(page, backup);await settings(page)
  const before = await dbSnapshot(page)
  await page.evaluate(() => { const decode = window.createImageBitmap;Object.assign(window, { testSavedDecode: decode });window.createImageBitmap = (() => Promise.reject(new Error('injected decode'))) as typeof createImageBitmap })
  await page.getByRole('button', { name: 'バックアップを書き出す', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('バックアップを生成できませんでした');expect(await dbSnapshot(page)).toEqual(before)
  await page.evaluate(() => {
    window.createImageBitmap = (window as unknown as { testSavedDecode: typeof createImageBitmap }).testSavedDecode
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) { if (this.name === 'meta') throw new DOMException('injected', 'QuotaExceededError');return key === undefined ? put.call(this, value) : put.call(this, value, key) }
  })
  const downloading = page.waitForEvent('download');await page.getByRole('button', { name: 'バックアップを書き出す', exact: true }).click();await downloading
  await expect(page.getByRole('alert')).toContainText('書き出し要求の記録を保存できませんでした');expect(await dbSnapshot(page)).toEqual(before)
})

test('T18: Chromiumで画像40MiB・非画像8MiBの上限状態を復元・連続出力・再検証', async ({ page }) => {
  test.setTimeout(120000)
  await settings(page)
  const original = await page.evaluate(() => {
    const canvas = document.createElement('canvas');canvas.width = 16;canvas.height = 16
    const context = canvas.getContext('2d')!;context.fillStyle = '#94432e';context.fillRect(0, 0, 16, 16)
    const source = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]!), char => char.charCodeAt(0))
    const bytes = new Uint8Array(1024 ** 2);const padding = bytes.length - source.length - 12
    bytes.set(source.subarray(0, 33));const view = new DataView(bytes.buffer);view.setUint32(33, padding);bytes.set([114, 117, 83, 84], 37)
    // PNGの無視可能なancillary chunkに、自作のpaddingと正しいCRCを付ける。
    let crc = 0xffffffff
    for (const byte of bytes.subarray(37, 41 + padding)) { crc ^= byte;for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    view.setUint32(41 + padding, (crc ^ 0xffffffff) >>> 0);bytes.set(source.subarray(33), 45 + padding)
    const parts: string[] = [];for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
    return { mime: 'image/png' as const, width: 16, height: 16, byteLength: bytes.length, base64: btoa(parts.join('')) }
  })
  const backup = emptyBackup()
  for (let i = 0; i < 400; i++) backup.recipes.push({ ...recipe(`上限テスト ${i}`), memo: '', steps: Array.from({ length: 8 }, () => 'a'), isFavorite: false, imageIds: [] })
  for (let i = 0; i < 40; i++) { const owner = backup.recipes[Math.floor(i / 6)]!;const id = crypto.randomUUID();owner.imageIds.push(id);backup.images.push({ id, recipeId: owner.id, kind: 'screenshot', createdAt: instant, original: { ...original }, thumbnail: null }) }
  const metadata = { ...backup, images: backup.images.map(image => ({ ...image, original: { ...image.original, base64: '' } })) }
  let remaining = 8 * 1024 ** 2 - Buffer.byteLength(JSON.stringify(metadata))
  for (const recipe of backup.recipes) {
    const count = Math.min(remaining, 5000);recipe.memo = 'a'.repeat(count);remaining -= count
    for (let i = 0; i < recipe.steps.length; i++) { const count = Math.min(remaining, 1999);recipe.steps[i] += 'a'.repeat(count);remaining -= count }
  }
  expect(remaining).toBe(0)
  await restore(page, backup);await settings(page)
  await expect(page.getByText('40.00 MiB / 40 MiB', { exact: true })).toBeVisible()
  await expect(page.getByText('8.00 MiB / 8 MiB', { exact: true })).toBeVisible()
  for (let i = 0; i < 2; i++) {
    const output = await exportFile(page)
    expect(output.recipes).toHaveLength(400);expect(output.images).toHaveLength(40)
    expect(output.images.every(image => image.original.base64 === original.base64)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(64 * 1024 ** 2)
    await preview(page, output);await page.getByRole('button', { name: '復元をキャンセル', exact: true }).click()
  }
})
