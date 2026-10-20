// Uji penyusun jadwal otomatis (src/otomatis.ts). Node 24 membaca TypeScript langsung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buatDraf } from '../src/otomatis.ts'

const hari7 = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
const riders = (n) => Array.from({ length: n }, (_, i) => `r${i + 1}`)
const hitung = (grid, id) => Object.keys(grid).filter((k) => k.startsWith(id + '|')).length
const perHari = (grid, tgl, shift) => Object.entries(grid).filter(([k, s]) => k.endsWith('|' + tgl) && s === shift).length

test('kuota terpenuhi tiap hari, tanpa kekurangan', () => {
  const { grid, kurang } = buatDraf(riders(5), hari7, 2, 1)
  assert.deepEqual(kurang, [])
  for (const d of hari7) {
    assert.equal(perHari(grid, d, 'pagi'), 2)
    assert.equal(perHari(grid, d, 'siang'), 1)
  }
})

test('adil: selisih hari kerja antar rider paling banyak 1, tak ada yang lebih dari 6 hari', () => {
  const ids = riders(5)
  const { grid } = buatDraf(ids, hari7, 2, 1)
  const n = ids.map((id) => hitung(grid, id))
  assert.ok(Math.max(...n) - Math.min(...n) <= 1, `tidak merata: ${n}`)
  assert.ok(Math.max(...n) <= 6)
  assert.equal(n.reduce((a, b) => a + b, 0), 21) // 3 orang × 7 hari
})

test('satu rider tidak pernah dobel shift di hari yang sama', () => {
  const { grid } = buatDraf(riders(4), hari7, 2, 2)
  const kunci = Object.keys(grid)
  assert.equal(new Set(kunci).size, kunci.length)
})

test('rider kurang: kekurangan dilaporkan per hari (siang yang kosong duluan)', () => {
  const { grid, kurang } = buatDraf(riders(2), hari7, 2, 2)
  assert.equal(kurang.length, 7)
  assert.deepEqual(kurang[0], { tanggal: '2026-10-26', pagi: 0, siang: 2 })
  assert.equal(perHari(grid, '2026-10-26', 'pagi'), 2)
})

test('maksimal 6 hari kerja: hari ke-7 kosong bila semua rider sudah 6 hari', () => {
  const { grid, kurang } = buatDraf(riders(3), hari7, 3, 0)
  assert.equal(perHari(grid, '2026-11-01', 'pagi'), 0)
  assert.deepEqual(kurang.at(-1), { tanggal: '2026-11-01', pagi: 3, siang: 0 })
  riders(3).forEach((id) => assert.ok(hitung(grid, id) <= 6))
})

test('tanpa rider atau kuota 0: draf kosong, tidak error', () => {
  assert.deepEqual(buatDraf([], hari7, 2, 1).grid, {})
  assert.equal(buatDraf([], hari7, 2, 1).kurang.length, 7)
  assert.deepEqual(buatDraf(riders(3), hari7, 0, 0), { grid: {}, kurang: [] })
})

test('shift cenderung konsisten: rider pagi tetap pagi bila memungkinkan', () => {
  const ids = riders(6)
  const { grid } = buatDraf(ids, hari7, 3, 3) // semua rider masuk tiap hari, 6 hari maksimal
  const campur = ids.filter((id) => {
    const s = new Set(Object.entries(grid).filter(([k]) => k.startsWith(id + '|')).map(([, v]) => v))
    return s.size > 1
  })
  assert.ok(campur.length <= 2, `terlalu sering berganti shift: ${campur}`)
})
