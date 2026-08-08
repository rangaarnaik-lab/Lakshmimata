#!/usr/bin/env node
/** Regenerate src/data/industry-map.json from all-stocks.csv (NSE Code → sector/industry). */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const csvPath = path.join(root, 'all-stocks.csv')
const outPath = path.join(root, 'src/data/industry-map.json')

function parseLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { inQ = !inQ; continue }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out
}

const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n')
const map = {}
for (const line of lines.slice(1)) {
  const cols = parseLine(line)
  const sym = (cols[2] || '').trim()
  if (!sym) continue
  const sector = (cols[4] || '').trim()
  const industry = (cols[5] || '').trim()
  if (sector || industry) map[sym] = { sector, industry }
}

fs.writeFileSync(outPath, JSON.stringify(map))
console.log(`Wrote ${Object.keys(map).length} symbols → ${path.relative(root, outPath)}`)
