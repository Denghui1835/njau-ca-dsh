/**
 * test-docx.mjs —— 拿工作区里真实的 .docx 做往返体检。
 *
 * 检查三件事：
 *   1. 能读：段落/表格/样式能解析出来；
 *   2. 能写：写回去的包还是合法 ZIP + 合法 document.xml；
 *   3. 能再读：二次读取的内容与第一次一致（幂等），文字零丢失。
 *
 * 用法：node scripts/test-docx.mjs <file.docx>[...]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDocx, docToText } from '../lib/docx-read.js'
import { writeDocx } from '../lib/docx-write.js'
import { readZip } from '../lib/zip.js'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '..', '_wps_out')
mkdirSync(outDir, { recursive: true })

function stats(model) {
  let paragraphs = 0
  let tables = 0
  let cells = 0
  let runs = 0
  let chars = 0
  const walk = (blocks) => {
    for (const block of blocks) {
      if (block.type === 'p') {
        paragraphs += 1
        runs += block.runs.length
        chars += block.runs.reduce((n, r) => n + r.text.length, 0)
      } else if (block.type === 'table') {
        tables += 1
        for (const row of block.rows) {
          for (const cell of row) {
            cells += 1
            walk(cell.blocks)
          }
        }
      }
    }
  }
  walk(model.blocks)
  return { paragraphs, tables, cells, runs, chars }
}

let failed = 0

for (const file of process.argv.slice(2)) {
  console.log(`\n=== ${basename(file)} ===`)
  try {
    const original = readFileSync(file)
    const t0 = Date.now()
    const model = readDocx(original)
    const readMs = Date.now() - t0
    const s1 = stats(model)
    console.log(`读：${readMs}ms  段落 ${s1.paragraphs} · 表格 ${s1.tables} · 单元格 ${s1.cells} · run ${s1.runs} · 字数 ${s1.chars}`)
    console.log(`kind 分布：${JSON.stringify(countKinds(model))}`)

    const t1 = Date.now()
    const written = writeDocx(model, original)
    const writeMs = Date.now() - t1
    console.log(`写：${writeMs}ms  ${original.length} → ${written.length} 字节`)

    const outPath = join(outDir, basename(file))
    writeFileSync(outPath, written)

    // 包结构自检
    const parts = readZip(written)
    const needParts = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']
    for (const need of needParts) {
      if (!parts.entries.has(need)) throw new Error(`写回的包缺少部件 ${need}`)
    }

    // 二次读取：内容必须一致
    const again = readDocx(readFileSync(outPath))
    const s2 = stats(again)
    const text1 = docToText(model).trim()
    const text2 = docToText(again).trim()
    if (text1 !== text2) {
      failed += 1
      const a = text1.split('\n')
      const b = text2.split('\n')
      const at = a.findIndex((line, i) => line !== b[i])
      console.error(`✗ 往返后文字不一致，首处差异在第 ${at + 1} 行：`)
      console.error(`  原文: ${JSON.stringify(a[at])}`)
      console.error(`  回读: ${JSON.stringify(b[at])}`)
    } else {
      console.log(`✓ 往返一致（第二次 ${s2.paragraphs} 段 / ${s2.chars} 字）`)
    }
    console.log(`产物：${outPath}`)
  } catch (error) {
    failed += 1
    console.error(`✗ 失败：${error.message}`)
    console.error(error.stack)
  }
}

function countKinds(model) {
  const out = {}
  const walk = (blocks) => {
    for (const block of blocks) {
      if (block.type === 'p') out[block.kind] = (out[block.kind] ?? 0) + 1
      else if (block.type === 'table') {
        for (const row of block.rows) for (const cell of row) walk(cell.blocks)
      }
    }
  }
  walk(model.blocks)
  return out
}

console.log(failed === 0 ? '\n全部通过' : `\n有 ${failed} 个失败`)
process.exit(failed === 0 ? 0 : 1)
