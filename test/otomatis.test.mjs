// Uji penyusun jadwal otomatis (src/otomatis.ts). Node 24 membaca TypeScript langsung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buatDraf, hitungRiwayat } from '../src/otomatis.ts'

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

// ── aturan kondisi rider & keadilan lintas periode ──
const urutan = (grid, id, hari) => hari.map((d) => grid[`${id}|${d}`] ?? '') // mis. ['pagi','pagi','','siang']
const langsungGanti = (seq) => seq.some((s, i) => i > 0 && s && seq[i - 1] && s !== seq[i - 1]) // pagi→siang / siang→pagi tanpa libur
const beruntunMaks = (seq) => seq.reduce((m, s) => { m.cur = s ? m.cur + 1 : 0; m.max = Math.max(m.max, m.cur); return m }, { cur: 0, max: 0 }).max
const barisDari = (grid) => Object.entries(grid).map(([k, shift]) => { const [rider_id, tanggal] = k.split('|'); return { rider_id, tanggal, shift } })

test('shift TIDAK pernah berganti tanpa libur dulu, di berbagai konfigurasi, tanpa pelanggaran darurat', () => {
  for (const [n, p, s, hariN] of [[5, 2, 1, 28], [10, 3, 3, 30], [8, 2, 2, 21], [6, 2, 2, 14], [12, 4, 3, 28]]) {
    const ids = riders(n), hari = rentang('2026-10-26', hariN)
    const { grid, langgar, kurang } = buatDraf(ids, hari, p, s)
    for (const id of ids) assert.equal(langsungGanti(urutan(grid, id, hari)), false, `${n} rider ${p}+${s}: ${id} ganti shift tanpa libur`)
    assert.deepEqual(langgar, [], `${n} rider ${p}+${s}`)
    assert.deepEqual(kurang, [], `${n} rider ${p}+${s}: kuota tidak terpenuhi`)
  }
})

test('batas 6 hari BERTURUT-TURUT (bukan hanya per minggu kalender)', () => {
  const ids = riders(4), hari = rentang('2026-10-26', 28)
  const { grid } = buatDraf(ids, hari, 2, 1)
  for (const id of ids) assert.ok(beruntunMaks(urutan(grid, id, hari)) <= 6, `${id} bekerja lebih dari 6 hari berturut-turut`)
  // berasal dari periode sebelumnya: sudah 6 hari berturut-turut → hari pertama harus libur
  const r = buatDraf(riders(3), ['2026-10-26'], 2, 1, { riwayat: { r1: { hk: 6, shiftKemarin: 'pagi', shiftTerakhir: 'pagi', beruntun: 6, pekanBerjalan: 0 } } })
  assert.equal(r.grid['r1|2026-10-26'], undefined)
})

test('setelah libur rider melanjutkan shift sebelum libur (ritme tidur terjaga), bukan dipaksa pagi', () => {
  const awal = (terakhir) => ({ r1: { hk: 0, shiftKemarin: '', shiftTerakhir: terakhir, beruntun: 0, pekanBerjalan: 0 }, r2: { hk: 9, shiftKemarin: '', shiftTerakhir: 'pagi', beruntun: 0, pekanBerjalan: 0 }, r3: { hk: 9, shiftKemarin: '', shiftTerakhir: 'pagi', beruntun: 0, pekanBerjalan: 0 } })
  assert.equal(buatDraf(riders(3), ['2026-10-26'], 1, 1, { riwayat: awal('siang') }).grid['r1|2026-10-26'], 'siang')
  assert.equal(buatDraf(riders(3), ['2026-10-26'], 1, 1, { riwayat: awal('pagi') }).grid['r1|2026-10-26'], 'pagi')
})

test('melanjutkan dari periode sebelumnya: kemarin siang tidak boleh langsung pagi', () => {
  const riwayat = { r1: { hk: 1, shiftKemarin: 'siang', shiftTerakhir: 'siang', beruntun: 1, pekanBerjalan: 1 } }
  const { grid, langgar } = buatDraf(riders(3), ['2026-10-27'], 2, 0, { riwayat }) // hanya ada slot pagi
  assert.equal(grid['r1|2026-10-27'], undefined) // r1 libur dulu
  assert.equal(grid['r2|2026-10-27'], 'pagi')
  assert.equal(grid['r3|2026-10-27'], 'pagi')
  assert.deepEqual(langgar, [])
})

test('adil lintas minggu walau jadwal dibuat minggu demi minggu: yang minggu lalu lebih banyak kerja, minggu ini lebih sedikit', () => {
  const ids = riders(5), minggu1 = rentang('2026-10-26', 7), minggu2 = rentang('2026-11-02', 7)
  const w1 = buatDraf(ids, minggu1, 2, 1).grid
  const hk1 = ids.map((id) => hitung(w1, id))
  const w2 = buatDraf(ids, minggu2, 2, 1, { riwayat: hitungRiwayat(barisDari(w1), ids, '2026-11-02') }).grid
  const hk2 = ids.map((id) => hitung(w2, id))
  const total = ids.map((_, i) => hk1[i] + hk2[i])
  assert.ok(Math.max(...total) - Math.min(...total) <= 1, `total 2 minggu tidak merata: ${total}`)
  const banyak = hk1.indexOf(Math.max(...hk1)), sedikit = hk1.indexOf(Math.min(...hk1))
  if (hk1[banyak] > hk1[sedikit]) assert.ok(hk2[banyak] <= hk2[sedikit], `minggu 2 harus dibalik: minggu1=${hk1} minggu2=${hk2}`)
  // pembanding: tanpa riwayat, minggu 2 identik dengan minggu 1 (tidak ada ingatan) — itulah yang diperbaiki
  assert.deepEqual(buatDraf(ids, minggu2, 2, 1).grid && ids.map((id) => hitung(buatDraf(ids, minggu2, 2, 1).grid, id)), hk1)
})

test('kuota mustahil dipenuhi tanpa melanggar aturan shift: kuota diutamakan, pelanggaran DILAPORKAN (tidak diam-diam)', () => {
  // keduanya kemarin pagi; kuota 1 pagi + 1 siang → salah satu terpaksa pindah ke siang tanpa libur
  const riwayat = { r1: { hk: 3, shiftKemarin: 'pagi', shiftTerakhir: 'pagi', beruntun: 3, pekanBerjalan: 3 }, r2: { hk: 3, shiftKemarin: 'pagi', shiftTerakhir: 'pagi', beruntun: 3, pekanBerjalan: 3 } }
  const { grid, langgar, kurang } = buatDraf(riders(2), ['2026-10-29'], 1, 1, { riwayat })
  assert.equal(grid['r1|2026-10-29'], 'pagi')
  assert.equal(grid['r2|2026-10-29'], 'siang')
  assert.deepEqual(langgar, [{ tanggal: '2026-10-29', riderId: 'r2' }])
  assert.deepEqual(kurang, [])
})

test('hitungRiwayat: hari kerja, shift kemarin/terakhir, berturut-turut, dan minggu berjalan; libur diabaikan', () => {
  const rows = [
    { rider_id: 'r1', tanggal: '2026-10-26', shift: 'pagi' }, { rider_id: 'r1', tanggal: '2026-10-27', shift: 'pagi' },
    { rider_id: 'r1', tanggal: '2026-10-24', shift: 'siang' }, { rider_id: 'r1', tanggal: '2026-10-25', shift: 'off' },
    { rider_id: 'r2', tanggal: '2026-10-20', shift: 'siang' }, { rider_id: 'r2', tanggal: '2026-10-21', shift: 'siang' },
  ]
  const h = hitungRiwayat(rows, ['r1', 'r2', 'r3'], '2026-10-28') // Rabu
  assert.deepEqual(h.r1, { hk: 3, shiftKemarin: 'pagi', shiftTerakhir: 'pagi', beruntun: 2, pekanBerjalan: 2 })
  assert.deepEqual(h.r2, { hk: 2, shiftKemarin: '', shiftTerakhir: 'siang', beruntun: 0, pekanBerjalan: 0 })
  assert.deepEqual(h.r3, { hk: 0, shiftKemarin: '', shiftTerakhir: '', beruntun: 0, pekanBerjalan: 0 })
})

test('tanpa rider atau kuota 0: draf kosong, tidak error', () => {
  assert.deepEqual(buatDraf([], hari7, 2, 1).grid, {})
  assert.equal(buatDraf([], hari7, 2, 1).kurang.length, 7)
  assert.deepEqual(buatDraf(riders(3), hari7, 0, 0), { grid: {}, kurang: [], langgar: [] })
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
