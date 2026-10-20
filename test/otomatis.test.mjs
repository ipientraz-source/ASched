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

const rentang = (dari, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(dari + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10))
const senin = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10) }
const maksPerPekan = (grid, ids) => Math.max(...ids.flatMap((id) => {
  const m = {}
  for (const k of Object.keys(grid)) if (k.startsWith(id + '|')) { const p = senin(k.split('|')[1]); m[p] = (m[p] ?? 0) + 1 }
  return Object.values(m)
}))

test('periode bebas 14 hari: batas 6 hari dihitung per minggu, bukan seluruh rentang', () => {
  const ids = riders(3), hari = rentang('2026-10-26', 14)
  const { grid, kurang } = buatDraf(ids, hari, 3, 0) // 3 rider, kuota 3/hari: semua harus masuk tiap hari kecuali batas mingguan
  assert.ok(maksPerPekan(grid, ids) <= 6)
  assert.equal(Math.max(...ids.map((id) => hitung(grid, id))), 12) // 6 + 6, bukan 6 untuk seluruh 14 hari
  assert.equal(kurang.length, 2) // hari ke-7 dan ke-14 tak terpenuhi (semua sudah 6 hari di minggunya)
})

test('periode mulai di tengah minggu (Rabu–Selasa) tetap menghormati batas per minggu kalender', () => {
  const ids = riders(3), hari = rentang('2026-10-28', 14) // Rabu → Selasa 2 minggu kemudian
  const { grid } = buatDraf(ids, hari, 3, 0)
  assert.ok(maksPerPekan(grid, ids) <= 6)
})

test('periode 1 hari dan periode sebulan berjalan; kuota terpenuhi bila rider cukup', () => {
  const satu = buatDraf(riders(4), ['2026-10-26'], 2, 2)
  assert.equal(Object.keys(satu.grid).length, 4)
  assert.deepEqual(satu.kurang, [])
  const ids = riders(10), bulan = rentang('2026-11-01', 30)
  const { grid, kurang } = buatDraf(ids, bulan, 3, 3)
  assert.deepEqual(kurang, [])
  assert.ok(maksPerPekan(grid, ids) <= 6)
  const n = ids.map((id) => hitung(grid, id))
  assert.ok(Math.max(...n) - Math.min(...n) <= 1, `tidak merata: ${n}`)
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
