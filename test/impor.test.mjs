// Uji logika import dari file absensi (src/impor.ts). Node 24 membaca TypeScript langsung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bacaCsvMotor, cocokDs, namaDsBaru, normPlat, ringkasPerRider, siapkanMotor, tahunDariVin } from '../src/impor.ts'

const DS = ['DS ABDESIR', 'DS ALAM SUTRA', 'DS BALIKPAPAN', 'DS GALAXY', 'DS GOWA', 'DS HAYAM WURUK', 'DS PEMURUS', 'DS TIKALA ARES', 'DS UJUNG ASPAL', 'DS UJUNG PANDANG MAKASSAR']
const baris = (kode, nama, ds, n = 1) => ({ baris: n, kode_mtr: kode, nama, no_hp: '', ds, status: '' })

const CSV_MOTOR = [
  ['DS Location', 'License Plate', 'VIN'],
  ['Dark Store Alfagift -  Antapani', 'B 5608 SWF', 'MH2AEB1H8TJ000550'],
  ['Dark Store Alfagift - Galaxy', 'B 4785 SWY', 'MH2AEB1H0TJ000218'],
  ['Dark Store Alfagift - Alam Sutera', 'B4672SWN', 'MH2AEB1H4SJ002956'],
  ['DS Hayam Wuruk', 'b  5592 swf', 'MH2AEB1H0TJ000509'],
  ['Grand Total', '', ''],
]

test('impor motor: kolom dikenali (nama bebas), baris Grand Total dibuang, plat dirapikan, tahun dari VIN', () => {
  const { baris, galat } = bacaCsvMotor(CSV_MOTOR)
  assert.equal(galat, '')
  assert.equal(baris.length, 4) // Grand Total tanpa plat/VIN tidak ikut
  assert.deepEqual(baris.map((b) => normPlat(b.plat)), ['B 5608 SWF', 'B 4785 SWY', 'B 4672 SWN', 'B 5592 SWF'])
  assert.equal(tahunDariVin('MH2AEB1H8TJ000550'), 2026) // T
  assert.equal(tahunDariVin('MH2AEB1H4SJ002956'), 2025) // S
  assert.equal(tahunDariVin('PENDEK'), null)
  assert.match(bacaCsvMotor([['Nama', 'Warna'], ['a', 'b']]).galat, /Kolom wajib/)
  // nama kolom lain tetap dikenali, VIN opsional
  assert.equal(bacaCsvMotor([['Lokasi', 'Nopol'], ['DS X', 'B 1 AA']]).baris[0].vin, '')
})

test('impor motor: lokasi dicocokkan ke DS yang ada; plat/VIN terdaftar atau dobel dan DS belum ada ditandai', () => {
  const { baris } = bacaCsvMotor(CSV_MOTOR)
  const ds = ['DS GALAXY', 'DS HAYAM WURUK', 'DS ALAM SUTRA']
  const kosong = { plat: [], vin: [], kode: [] }
  const h = siapkanMotor(baris, ds, kosong, true)
  assert.deepEqual(h.map((x) => x.ds), [null, 'DS GALAXY', 'DS ALAM SUTRA', 'DS HAYAM WURUK']) // Antapani belum ada
  assert.equal(h[0].dsBaru, 'DS ANTAPANI')
  assert.deepEqual(h.map((x) => x.masalah), ['', '', '', '']) // DS baru boleh dibuat
  assert.deepEqual(h.map((x) => x.kode), ['B 5608 SWF', 'B 4785 SWY', 'B 4672 SWN', 'B 5592 SWF']) // kode = plat
  assert.equal(h[0].tahun, 2026)
  // DS baru tidak boleh dibuat → baris itu ditolak
  assert.equal(siapkanMotor(baris, ds, kosong, false)[0].masalah, 'DS belum ada')
  // sudah terdaftar (plat atau VIN) dan dobel di dalam file
  const ada = siapkanMotor(baris, ds, { plat: ['B 4785 SWY'], vin: ['mh2aeb1h0tj000509'], kode: [] }, true)
  assert.equal(ada[1].masalah, 'Plat sudah terdaftar')
  assert.equal(ada[3].masalah, 'VIN sudah terdaftar')
  const dobel = siapkanMotor([...baris, { baris: 9, lokasi: 'DS Hayam Wuruk', plat: 'B 5608 SWF', vin: '' }], ds, kosong, true)
  assert.equal(dobel[0].masalah, 'Plat dobel di file')
  assert.equal(dobel[4].masalah, 'Plat dobel di file')
  // VIN rusak
  assert.match(siapkanMotor([{ baris: 2, lokasi: 'DS Galaxy', plat: 'B 1 AA', vin: 'ABC123' }], ds, kosong, true)[0].masalah, /VIN harus 17/)
})

test('14 lokasi di file absensi: 10 cocok ke DS yang ada, 4 belum punya DS', () => {
  const lokasi = {
    'Dark Store Alfagift - Ujung Aspal': 'DS UJUNG ASPAL',
    'Dark Store Alfagift - Galaxy': 'DS GALAXY',
    'Dark Store Alfagift - Alam Sutera': 'DS ALAM SUTRA',
    'Dark Store Alfagift - Hayam Wuruk': 'DS HAYAM WURUK',
    'Dark Store Alfagift - Pemurus': 'DS PEMURUS',
    'Dark Store Alfagift - Ujung Pandang': 'DS UJUNG PANDANG MAKASSAR',
    'DS HASSANUDIN GOWA': 'DS GOWA',
    'Dark Store Alfagift - Tikala Ares': 'DS TIKALA ARES',
    'Dark Store Alfagift - Abdesir': 'DS ABDESIR',
    'Dark Store Alfagift - Balikpapan': 'DS BALIKPAPAN',
    'Dark Store - Jelupang': null,
    'Dark Store Alfagift - Cihampelas': null,
    'Dark Store Alfagift - Antapani': null,
    'Dark Store Alfagift - DC Bandung': null,
  }
  for (const [lok, harus] of Object.entries(lokasi)) assert.equal(cocokDs(lok, DS), harus, lok)
})

test('salah ketik tidak dicocokkan (tidak membuat DS hantu diam-diam), huruf besar/kecil tak berpengaruh', () => {
  assert.equal(cocokDs('Galaxi', DS), null)
  assert.equal(cocokDs('galaxy', DS), 'DS GALAXY')
  assert.equal(cocokDs('  DS   galaxy ', DS), 'DS GALAXY')
  assert.equal(cocokDs('', DS), null)
})

test('nama DS baru yang diusulkan rapi', () => {
  assert.equal(namaDsBaru('Dark Store - Jelupang'), 'DS JELUPANG')
  assert.equal(namaDsBaru('Dark Store Alfagift - DC Bandung'), 'DS DC BANDUNG')
  assert.equal(namaDsBaru('dark store alfagift -  antapani'), 'DS ANTAPANI')
})

test('banyak baris per rider jadi satu; DS = lokasi paling sering; nama dirapikan', () => {
  const r = ringkasPerRider([
    baris('MTR1', 'Budi  Santoso ', 'Dark Store Alfagift - Galaxy', 2),
    baris('MTR1', 'Budi Santoso', 'Dark Store Alfagift - Alam Sutera', 3),
    baris('MTR1', 'Budi Santoso', 'Dark Store Alfagift - Alam Sutera', 4),
    baris('MTR2', 'Siti', 'Dark Store Alfagift - Galaxy', 5),
  ])
  assert.equal(r.length, 2)
  const budi = r.find((x) => x.kode_mtr === 'MTR1')
  assert.equal(budi.ds, 'Dark Store Alfagift - Alam Sutera') // 2× lawan 1×
  assert.equal(budi.nama, 'Budi Santoso')
  assert.equal(budi.baris, 2) // nomor baris kemunculan pertama
})

test('kode huruf kecil/spasi dianggap sama; baris tanpa kode tetap dibawa agar ditolak server', () => {
  const r = ringkasPerRider([baris('mtr1 ', 'A', 'X'), baris('MTR1', 'A', 'X'), baris('', 'Tanpa Kode', 'X')])
  assert.equal(r.length, 2)
  assert.equal(r.at(-1).nama, 'Tanpa Kode')
})

test('rider tanpa lokasi sama sekali tetap diimpor dengan DS kosong', () => {
  assert.equal(ringkasPerRider([baris('MTR9', 'Eko', '')])[0].ds, '')
})
