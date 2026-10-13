import { chromium, expect, test, type Page } from '@playwright/test'
import type { ImageAsset } from '../../src/domain/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function fixture(page: Page, mime = 'image/png', width = 2400, height = 1200, transparent = false, noise = false) {
  const data = await page.evaluate(({ mime, width, height, transparent, noise }) => {
    const canvas = document.createElement('canvas');canvas.width = width;canvas.height = height
    const context = canvas.getContext('2d')!
    if (!transparent) {context.fillStyle = '#fff1de';context.fillRect(0, 0, width, height)}
    if (noise) {
      const pixels = context.createImageData(width, height);let seed = 12345
      for (let i = 0; i < pixels.data.length; i += 4) {seed ^= seed << 13;seed ^= seed >>> 17;seed ^= seed << 5;pixels.data[i] = seed & 255;pixels.data[i + 1] = (seed >>> 8) & 255;pixels.data[i + 2] = (seed >>> 16) & 255;pixels.data[i + 3] = 255}
      context.putImageData(pixels, 0, 0)
    }
    context.fillStyle = '#94432e';context.fillRect(width / 4, height / 4, width / 2, height / 2)
    context.fillStyle = '#fff';context.font = '40px sans-serif';context.fillText('Recipe test', width / 3, height / 2)
    return canvas.toDataURL(mime).split(',')[1]!
  }, { mime, width, height, transparent, noise })
  return { name: `fixture.${mime.split('/')[1]}`, mimeType: mime, buffer: Buffer.from(data, 'base64') }
}
async function assets(page: Page) {
  return page.evaluate(async () => {
    const records = await new Promise<ImageAsset[]>((resolve, reject) => {
      const open = indexedDB.open('sano-recipe-book', 1)
      open.onerror = () => reject(new Error('test read failed'))
      open.onsuccess = () => {
        const db = open.result;const tx = db.transaction('images');const request = tx.objectStore('images').getAll()
        request.onsuccess = () => resolve(request.result as ImageAsset[]);request.onerror = () => reject(new Error('test read failed'));tx.oncomplete = () => db.close()
      }
    })
    return records.map(image => ({ id: image.id, kind: image.kind, mime: image.mime, width: image.width, height: image.height, size: image.blob.size, thumbnail: image.thumbnail && { width: image.thumbnail.width, height: image.thumbnail.height, size: image.thumbnail.blob.size } }))
  })
}
async function save(page: Page, title = '架空の写真付き料理') {
  await page.getByLabel('料理名').fill(title)
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
}
test('T07: 3形式・圧縮・サムネイル・表紙・画面画像・拡大・再読込・削除', async ({ page }) => {
  const errors: string[] = [];page.on('pageerror', error => errors.push(error.message))
  await page.goto('#/recipes/new')
  await expect(page.getByLabel('撮影ファイル', { exact: true })).toHaveAttribute('capture', 'environment')
  const png = await fixture(page);const jpeg = await fixture(page, 'image/jpeg');const webp = await fixture(page, 'image/webp')
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles([png, jpeg, webp])
  await expect(page.locator('.image-preview')).toHaveCount(3)
  await page.getByLabel('スクリーンショットファイル', { exact: true }).setInputFiles(await fixture(page, 'image/png', 1000, 4000))
  await expect(page.locator('.image-preview')).toHaveCount(4)
  await page.getByRole('button', { name: '表紙にする · 写真2', exact: true }).click()
  await page.getByRole('button', { name: '写真4を上へ', exact: true }).click()
  await save(page)
  const rows = await assets(page)
  expect(rows).toHaveLength(4)
  for (const image of rows) {
    expect(image.size).toBeLessThanOrEqual(1024 * 1024)
    if (image.kind === 'dish') {expect(image.width).toBe(1600);expect(image.height).toBe(800);expect(image.mime).toBe('image/jpeg');expect(image.thumbnail?.width).toBe(320);expect(image.thumbnail?.height).toBe(160);expect(image.thumbnail!.size).toBeLessThanOrEqual(100 * 1024)}
    else {expect(image.width).toBe(640);expect(image.height).toBe(2560);expect(image.thumbnail).toBeNull()}
  }
  await page.reload()
  await expect(page.locator('.detail-gallery img')).toHaveCount(4)
  await page.getByRole('button', { name: '添付画像3を拡大', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '写真を拡大' })).toBeVisible()
  await page.getByRole('button', { name: '原寸表示' }).click()
  await expect(page.locator('.viewer-image')).toHaveClass(/actual-size/)
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(page.getByRole('button', { name: '添付画像3を拡大', exact: true })).toBeFocused()
  await page.getByRole('link', { name: 'レシピ一覧', exact: false }).first().click()
  await expect(page.locator('.card-photo img')).toBeVisible()
  await page.locator('.recipe-card-link').click()
  await page.getByRole('button', { name: 'レシピを削除', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('写真4件')
  await page.getByRole('button', { name: '削除する', exact: true }).click()
  expect(await assets(page)).toEqual([])
  expect(errors).toEqual([])
})
test('T07: プレビュー・拡大・画面離脱後にObject URLを解放する', async ({ page }) => {
  await page.addInitScript(() => {
    const created = URL.createObjectURL.bind(URL);const revoked = URL.revokeObjectURL.bind(URL);const active = new Set<string>()
    URL.createObjectURL = object => {const url = created(object);active.add(url);return url}
    URL.revokeObjectURL = url => {active.delete(url);revoked(url)}
    Reflect.set(window, 'testObjectUrls', active)
  })
  await page.goto('#/recipes/new');await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(await fixture(page, 'image/png', 200, 100));await expect(page.locator('.image-preview img')).toBeVisible()
  await save(page);await page.getByRole('button', { name: '表紙写真を拡大', exact: true }).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.goto('#/settings');await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'testObjectUrls') as Set<string>).size)).toBe(0)
})
test('T07: EXIF方向を反映し、元メタデータを保存しない', async ({ page }) => {
  await page.goto('#/recipes/new')
  const image = await fixture(page, 'image/jpeg', 400, 200)
  const exif = Buffer.alloc(32);exif.write('Exif', 0);exif.write('II', 6);exif.writeUInt16LE(42, 8);exif.writeUInt32LE(8, 10);exif.writeUInt16LE(1, 14);exif.writeUInt16LE(0x112, 16);exif.writeUInt16LE(3, 18);exif.writeUInt32LE(1, 20);exif.writeUInt16LE(6, 24)
  image.buffer = Buffer.concat([image.buffer.subarray(0, 2), Buffer.from([255, 225, 0, 34]), exif, image.buffer.subarray(2)])
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(image)
  await expect(page.locator('.image-preview')).toHaveCount(1)
  await save(page)
  const rows = await assets(page);expect(rows[0]).toMatchObject({ width: 200, height: 400 })
  const containsExif = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {const req = indexedDB.open('sano-recipe-book');req.onsuccess = () => resolve(req.result)})
    const rows = await new Promise<ImageAsset[]>(resolve => {const req = db.transaction('images').objectStore('images').getAll();req.onsuccess = () => resolve(req.result as ImageAsset[])})
    db.close();const bytes = new Uint8Array(await rows[0]!.blob.arrayBuffer())
    return new TextDecoder('latin1').decode(bytes).includes('Exif')
  })
  expect(containsExif).toBe(false)
})
test('T07: 透明料理写真は白背景、画面画像は透明を保持', async ({ page }) => {
  await page.goto('#/recipes/new');const image = await fixture(page, 'image/png', 100, 100, true)
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(image);await expect(page.locator('.image-preview')).toHaveCount(1)
  await page.getByLabel('スクリーンショットファイル', { exact: true }).setInputFiles(image);await expect(page.locator('.image-preview')).toHaveCount(2)
  await save(page)
  const pixels = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {const req = indexedDB.open('sano-recipe-book');req.onsuccess = () => resolve(req.result)})
    const rows = await new Promise<ImageAsset[]>(resolve => {const req = db.transaction('images').objectStore('images').getAll();req.onsuccess = () => resolve(req.result as ImageAsset[])})
    db.close();const result: Record<string, number[]> = {}
    for (const row of rows) {const bitmap = await createImageBitmap(row.blob);const canvas = document.createElement('canvas');canvas.width = 100;canvas.height = 100;const context = canvas.getContext('2d')!;context.drawImage(bitmap, 0, 0);result[row.kind] = [...context.getImageData(0, 0, 1, 1).data];bitmap.close()}
    return result
  })
  expect(pixels.dish).toEqual([255, 255, 255, 255]);expect(pixels.screenshot?.[3]).toBe(0)
})
test('T07: 大きな画面画像をPNGからWebPへ再圧縮して1MiB以内に収める', async ({ page }) => {
  await page.goto('#/recipes/new');const png = await fixture(page, 'image/png', 2600, 1500, false, true)
  expect(png.buffer.length).toBeLessThanOrEqual(20 * 1024 * 1024)
  await page.getByLabel('スクリーンショットファイル', { exact: true }).setInputFiles(png);await expect(page.locator('.image-preview')).toHaveCount(1)
  await save(page);const rows = await assets(page)
  expect(rows[0]?.mime).toBe('image/webp');expect(rows[0]!.size).toBeLessThanOrEqual(1024 * 1024);expect(rows[0]!.width).toBeLessThan(2560)
})
test('T01: 写真Blob・サムネイル・定番をブラウザ再起動後も再表示', async ({ baseURL }, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), 'recipe-media-profile-'))
  const options = { ...testInfo.project.use.launchOptions, headless: true, viewport: { width: 390, height: 844 } }
  let context = await chromium.launchPersistentContext(profile, options)
  try {
    let page = await context.newPage();await page.goto(`${baseURL}#/recipes/new`)
    await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(await fixture(page, 'image/png', 200, 100));await expect(page.locator('.image-preview')).toHaveCount(1)
    await page.getByLabel('佐野家の定番にする').check();await save(page)
    const before = await assets(page);await context.close()
    context = await chromium.launchPersistentContext(profile, options);page = await context.newPage();await page.goto(`${baseURL}#/favorites`)
    await expect(page.locator('.card-photo img')).toBeVisible();expect(await assets(page)).toEqual(before)
    await expect(page.getByRole('button', { name: '架空の写真付き料理を定番から外す', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.locator('.recipe-card-link').click();await expect(page.locator('.detail-gallery img')).toBeVisible()
  } finally {await context.close();await rm(profile, { recursive: true, force: true })}
})
test('T03/T07: 表紙削除のフォールバック・写真追加/削除の取消・定番のフォーム編集', async ({ page }) => {
  await page.goto('#/recipes/new');const image = await fixture(page, 'image/png', 200, 100)
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles([image, image]);await expect(page.locator('.image-preview')).toHaveCount(2)
  await page.getByLabel('佐野家の定番にする').check();await save(page)
  const before = await assets(page)
  const originalCoverId = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {const req = indexedDB.open('sano-recipe-book');req.onsuccess = () => resolve(req.result)})
    const id = await new Promise<string>(resolve => {const req = db.transaction('recipes').objectStore('recipes').getAll();req.onsuccess = () => resolve((req.result as { coverImageId: string }[])[0]!.coverImageId)})
    db.close();return id
  })
  await page.getByRole('link', { name: 'レシピを編集' }).click()
  await expect(page.locator('.image-preview')).toHaveCount(2)
  await page.getByRole('button', { name: '写真1を削除', exact: true }).click()
  await expect(page.getByRole('button', { name: '表紙に設定済み · 写真1', exact: true })).toBeVisible()
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(image);await expect(page.locator('.image-preview')).toHaveCount(2)
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();await page.getByRole('button', { name: '破棄して戻る', exact: true }).click()
  expect(await assets(page)).toEqual(before)
  await page.getByRole('link', { name: 'レシピを編集' }).click();await expect(page.locator('.image-preview')).toHaveCount(2)
  await page.getByRole('button', { name: '写真1を削除', exact: true }).click();await page.getByLabel('佐野家の定番にする').uncheck()
  await page.getByRole('button', { name: '保存する', exact: true }).click();await expect(page.getByRole('heading', { name: '架空の写真付き料理', exact: true })).toBeVisible()
  expect((await assets(page)).map(row => row.id)).toEqual(before.filter(row => row.id !== originalCoverId).map(row => row.id))
  await expect(page.getByRole('button', { name: '架空の写真付き料理を定番に登録', exact: true })).toHaveAttribute('aria-pressed', 'false')
})
test('T08/T07: 不正形式・アニメーション・復号失敗・7枚を拒否し入力を保持', async ({ page }) => {
  await page.goto('#/recipes/new');await page.getByLabel('料理名').fill('入力は残す')
  const svg = {name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')}
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(svg);await expect(page.getByRole('alert')).toContainText('形式が不正')
  const png = await fixture(page, 'image/png', 100, 50)
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles({ ...png, mimeType: 'image/jpeg' });await expect(page.getByRole('alert')).toContainText('一致しません')
  const apng = Buffer.concat([png.buffer.subarray(0, 33), Buffer.from([0, 0, 0, 8]), Buffer.from('acTL'), Buffer.alloc(12), png.buffer.subarray(33)])
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles({ ...png, buffer: apng });await expect(page.getByRole('alert')).toContainText('アニメーションPNG')
  const brokenJpeg = {name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 192, 0, 8, 8, 0, 2, 0, 3, 0, 255, 217])}
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(brokenJpeg);await expect(page.getByRole('alert')).toContainText('読み取れません')
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(Array.from({ length: 7 }, () => png));await expect(page.getByRole('alert')).toContainText('合計6枚')
  await expect(page.getByLabel('料理名')).toHaveValue('入力は残す')
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(Array.from({ length: 6 }, () => png));await expect(page.locator('.image-preview')).toHaveCount(6)
  await expect(page.getByRole('button', { name: '料理写真を選ぶ', exact: true })).toBeDisabled()
})
test('T13: 写真置換の保存失敗で旧Blobと準備済みプレビューを保持', async ({ page }) => {
  await page.goto('#/recipes/new');const png = await fixture(page, 'image/png', 100, 50)
  await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(png);await expect(page.locator('.image-preview')).toHaveCount(1);await save(page)
  const before = await assets(page)
  await page.getByRole('link', { name: 'レシピを編集' }).click();await expect(page.locator('.image-preview')).toHaveCount(1)
  await page.getByRole('button', { name: '写真1を削除', exact: true }).click();await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(png);await expect(page.locator('.image-preview')).toHaveCount(1)
  await page.evaluate(() => {const put = IDBObjectStore.prototype.put;IDBObjectStore.prototype.put = function (...args) {if (this.name === 'meta') throw new DOMException('injected', 'QuotaExceededError');return put.apply(this, args)}})
  await page.getByRole('button', { name: '保存する', exact: true }).click();await expect(page.getByRole('alert')).toContainText('保存領域が足りません')
  await expect(page.locator('.image-preview img')).toBeVisible();expect(await assets(page)).toEqual(before)
})
test('T05: 定番一覧・解除失敗・成功・複数タグAND・ホームから1タップ', async ({ page }) => {
  await page.goto('#/recipes/new');await page.getByLabel('タグ', { exact: true }).fill('ＡＢＣ\n弁当');await page.getByLabel('佐野家の定番にする').check();await save(page, '架空の定番')
  await page.goto('#/');await page.getByRole('link', { name: 'すべて →', exact: true }).click()
  await expect(page.getByRole('heading', { name: '佐野家の定番', exact: true })).toBeVisible();await expect(page.locator('.recipe-card')).toHaveCount(1)
  await page.getByText('タグで絞り込む（複数選択・すべて含む）', { exact: true }).click();await page.getByLabel('ＡＢＣ', { exact: true }).check();await page.getByLabel('弁当', { exact: true }).check();await expect(page.locator('.recipe-card')).toHaveCount(1)
  await page.evaluate(() => {Reflect.set(window, 'testPut', IDBObjectStore.prototype.put);const put = IDBObjectStore.prototype.put;IDBObjectStore.prototype.put = function (...args) {if (this.name === 'meta') throw new DOMException('injected', 'AbortError');return put.apply(this, args)}})
  await page.getByRole('button', { name: '架空の定番を定番から外す', exact: true }).click();await expect(page.getByRole('alert')).toContainText('変更できませんでした');await expect(page.locator('.recipe-card')).toHaveCount(1)
  await page.evaluate(() => {IDBObjectStore.prototype.put = Reflect.get(window, 'testPut') as IDBObjectStore['put']})
  await page.getByRole('button', { name: '架空の定番を定番から外す', exact: true }).click();await expect(page.getByText('まだ定番がありません', { exact: true })).toBeVisible();await expect(page.getByText('定番から外しました。', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'すべてのレシピへ →', exact: true }).click();await page.getByRole('button', { name: '架空の定番を定番に登録', exact: true }).click();await expect(page.getByText('定番に登録しました。', { exact: true })).toBeVisible()
  await page.reload();await expect(page.getByRole('button', { name: '架空の定番を定番から外す', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
test('T25: 写真レコード欠損でも本文を閲覧でき、編集では自動消去しない', async ({ page }) => {
  await page.goto('#/recipes/new');await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(await fixture(page, 'image/png', 100, 50));await expect(page.locator('.image-preview')).toHaveCount(1);await save(page)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {const req = indexedDB.open('sano-recipe-book');req.onsuccess = () => resolve(req.result)})
    const tx = db.transaction('images', 'readwrite');tx.objectStore('images').clear();await new Promise<void>(resolve => {tx.oncomplete = () => resolve()});db.close()
  })
  await page.reload();await expect(page.getByRole('heading', { name: '架空の写真付き料理', exact: true })).toBeVisible();await expect(page.getByText('写真を読み込めません', { exact: true }).first()).toBeVisible()
  await page.getByRole('link', { name: 'レシピを編集' }).click();await expect(page.getByRole('alert')).toContainText('写真の参照が一致しません');await expect(page.getByRole('button', { name: '保存する', exact: true })).toBeDisabled()
})
for (const [width, height] of [[320, 568], [360, 800], [390, 844], [430, 932]] as const) {
  test(`T23: 写真UIと定番一覧の${width}pxレイアウト`, async ({ page }) => {
    await page.setViewportSize({ width, height });await page.goto('#/recipes/new')
    await page.getByLabel('料理写真ファイル', { exact: true }).setInputFiles(await fixture(page, 'image/png', 200, 100));await expect(page.locator('.image-preview')).toHaveCount(1)
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await fits();await page.getByLabel('佐野家の定番にする').check();await save(page);await fits()
    await page.goto('#/favorites');await expect(page.locator('.card-photo img')).toBeVisible();await fits()
    await expect(page.getByRole('navigation').getByRole('link', { name: 'レシピ', exact: true })).toHaveAttribute('aria-current', 'page')
    await page.screenshot({ path: test.info().outputPath(`favorites-${width}.png`), fullPage: true })
  })
}
