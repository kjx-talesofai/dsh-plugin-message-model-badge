#!/usr/bin/env node
/**
 * Minimal ASAR reader (read-only) for inspecting the DeepSeek Harness desktop
 * bundle. Electron's asar is an uncompressed concatenation: an 8-byte pickle
 * carrying the size of the JSON directory, the directory itself, then file
 * bytes at the recorded offsets.
 *
 * Usage:
 *   node tools/asar.mjs list <archive> <regex>       # print matching paths
 *   node tools/asar.mjs cat  <archive> <innerPath>   # print one file to stdout
 *   node tools/asar.mjs grep <archive> <regex>       # print "path: match" lines
 */
import { openSync, readSync, closeSync, statSync } from 'node:fs'

function readHeader(path) {
  const fd = openSync(path, 'r')
  try {
    const sizeBuf = Buffer.alloc(8)
    readSync(fd, sizeBuf, 0, 8, 0)
    const headerSize = sizeBuf.readUInt32LE(4)
    const headerBuf = Buffer.alloc(headerSize)
    readSync(fd, headerBuf, 0, headerSize, 8)
    const jsonLen = headerBuf.readUInt32LE(4)
    const json = headerBuf.subarray(8, 8 + jsonLen).toString('utf8')
    return { json: JSON.parse(json), dataOffset: 8 + headerSize }
  } finally {
    closeSync(fd)
  }
}

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const full = prefix === '' ? name : `${prefix}/${name}`
    if (entry.files !== undefined) walk(entry, full, out)
    // Entries flagged `unpacked` live outside the archive (app.asar.unpacked);
    // they carry no usable offset and are not readable through this path.
    else if (typeof entry.offset === 'string' || typeof entry.offset === 'number') {
      out.push({ path: full, offset: Number(entry.offset), size: Number(entry.size ?? 0) })
    }
  }
}

function readFileRange(path, offset, size) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(size)
    readSync(fd, buf, 0, size, offset)
    return buf
  } finally {
    closeSync(fd)
  }
}

const [command, archive, argument] = process.argv.slice(2)
if (command === undefined || archive === undefined) {
  console.error('usage: asar.mjs <list|cat|grep> <archive> <regex|innerPath>')
  process.exit(2)
}

const { json, dataOffset } = readHeader(archive)
const entries = []
walk(json, '', entries)

if (command === 'list') {
  const re = new RegExp(argument ?? '')
  for (const entry of entries) if (re.test(entry.path)) console.log(`${entry.path}\t${entry.size}`)
} else if (command === 'cat') {
  const entry = entries.find((candidate) => candidate.path === argument)
  if (entry === undefined) {
    console.error(`not found: ${argument}`)
    process.exit(1)
  }
  process.stdout.write(readFileRange(archive, dataOffset + entry.offset, entry.size))
} else if (command === 'grep') {
  const re = new RegExp(argument ?? '')
  const limit = Number(process.env.LIMIT ?? 40)
  let hits = 0
  for (const entry of entries) {
    if (hits >= limit) break
    if (entry.size === 0 || entry.size > 4 * 1024 * 1024) continue
    const buf = readFileRange(archive, dataOffset + entry.offset, entry.size)
    // Binary sniff: a NUL in the first 4 KiB means it is not a text file.
    if (buf.subarray(0, 4096).includes(0)) continue
    const lines = buf.toString('utf8').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i])) {
        console.log(`${entry.path}:${i + 1}: ${lines[i].trim().slice(0, 300)}`)
        hits += 1
        if (hits >= limit) break
      }
    }
  }
  if (hits === 0) console.error('(no matches)')
} else {
  console.error(`unknown command: ${command}`)
  process.exit(2)
}

if (command === 'list') console.error(`${entries.length} entries in ${statSync(archive).size} bytes`)
