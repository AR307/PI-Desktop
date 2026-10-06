import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { test } from 'node:test'
import { noticeRoute, verifyLocalePairs } from './check-locales.mjs'

test('notice routes keep POSIX separators on every platform', () => {
  // `markdownFiles` builds its paths with `path.relative`, which separates with
  // backslashes on Windows. The notice is a routed link, so a backslash there
  // makes every Chinese mirror look like it is missing its source notice.
  const relative = ['01-product', '00-overview.md'].join(path.sep)

  assert.equal(noticeRoute(relative), '/spec/01-product/00-overview')
  assert.equal(noticeRoute('03-runtime/01-ipc-protocol.md'), '/spec/03-runtime/01-ipc-protocol')
  assert.ok(!noticeRoute(relative).includes('\\'))
})

test('every English specification has a valid Chinese mirror', () => {
  const { englishFiles, missing, invalid } = verifyLocalePairs()

  assert.ok(englishFiles.length > 0, 'expected to discover English specifications')
  assert.deepEqual(missing, [], 'Chinese specifications missing for the listed English pages')
  assert.deepEqual(invalid, [], 'Chinese pages whose source notice or structure is invalid')
})

test('the plugin development guide participates in locale checks', () => {
  assert.ok(verifyLocalePairs().englishFiles.includes('plugin-development.md'))
})

test('plugin guide checks reject missing mirrors and divergent theme examples', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-theme-docs-'))
  try {
    fs.mkdirSync(path.join(root, 'spec'))
    fs.mkdirSync(path.join(root, 'zh-CN/spec'), { recursive: true })
    const english = '# Plugins\n\n### 6.7 Theme\n\n```json\n{"base":"dark"}\n```\n\n### 6.8 Views\n'
    const chinese = '# 插件\n\n[英文源页面](/plugin-development)\n\n### 6.7 主题\n\n```json\n{"base":"dark"}\n```\n\n### 6.8 视图\n'
    fs.writeFileSync(path.join(root, 'plugin-development.md'), english)
    const mirror = path.join(root, 'zh-CN/plugin-development.md')
    assert.deepEqual(verifyLocalePairs(root).missing, ['plugin-development.md'])
    fs.writeFileSync(mirror, chinese)
    assert.deepEqual(verifyLocalePairs(root).invalid, [])
    for (const broken of [
      chinese.replace('"dark"', '"light"'),
      chinese.replace('### 6.7 主题', '### 6.6 主题'),
      chinese.replace('/plugin-development', '/wrong-source'),
    ]) {
      fs.writeFileSync(mirror, broken)
      assert.deepEqual(verifyLocalePairs(root).invalid, ['plugin-development.md'])
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
