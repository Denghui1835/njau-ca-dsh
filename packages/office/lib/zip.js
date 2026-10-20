/**
 * zip.js —— 零依赖 ZIP 读写（只依赖 node:zlib）。
 *
 * docx / xlsx / pptx 都是一个 ZIP 包：一堆 XML 部件 + 关系文件。
 * 想「自己做一个 WPS」而不是调 WPS，第一块砖就是能把包拆开再装回去。
 *
 * 支持范围（刻意做成够用而不是全）：
 *   - 读：stored(0) / deflate(8)，标准 ZIP64 不读（Office 文档几乎不会用到）；
 *     读时跳过 data descriptor（extended local header），长度一律以中央目录为准。
 *   - 写：deflate，固定时间戳（可复现，diff 稳定），不写 ZIP64、不加密。
 *
 * 为什么不用 fflate / jszip：这个插件要装进 DSH，多一个运行时依赖就多一次
 * 「上游升级 / 离线装不上」的故障面。node:zlib 是内置模块，永远不会缺席。
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'

// ---------------------------------------------------------------- CRC32

/** CRC32 查表：ZIP 每个条目都要它，table 只建一次。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

export function crc32(buffer) {
  let c = -1
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// ---------------------------------------------------------------- 读

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

function findEocd(buf) {
  // EOCD 至少 22 字节，后面可能跟最多 65535 字节的注释。
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

/**
 * 拆包。
 * @param {Buffer} buf
 * @returns {{ entries: Map<string, Buffer>, order: string[] }}
 */
export function readZip(buf) {
  if (buf.length < 22) throw new Error('zip: 文件太短，不是 ZIP 包')
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('zip: 找不到 EOCD 记录，可能不是 ZIP 包（或已损坏）')

  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  const order = []

  let p = cdOffset
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error(`zip: 第 ${i} 条中央目录损坏`)
    }
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compSize = buf.readUInt32LE(p + 20)
    const rawSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)

    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`zip: 条目 ${name} 的本地头损坏`)
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const comp = buf.subarray(dataStart, dataStart + compSize)

    let data
    if (method === 0) data = Buffer.from(comp)
    else if (method === 8) data = inflateRawSync(comp)
    else throw new Error(`zip: 条目 ${name} 用了不支持的压缩方式 ${method}`)

    if (data.length !== rawSize) {
      throw new Error(`zip: 条目 ${name} 解压后长度不符（期望 ${rawSize}，实际 ${data.length}）`)
    }
    if (crc32(data) !== crc) throw new Error(`zip: 条目 ${name} CRC 校验失败`)

    entries.set(name, data)
    order.push(name)
    p += 46 + nameLen + extraLen + commentLen
  }

  return { entries, order }
}

// ---------------------------------------------------------------- 写

/** 固定时间戳（1980-01-01 00:00），让同样内容产出同样的字节。 */
const DOS_TIME = 0
const DOS_DATE = 0x0021

/**
 * 装包。
 * @param {Array<{ name: string, data: Buffer | string }>} files
 * @returns {Buffer}
 */
export function writeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8')
    const deflated = deflateRawSync(raw, { level: 6 })
    // 压不小就存原文：小 XML 部件经常如此。
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 名称
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralBuf, eocd])
}
