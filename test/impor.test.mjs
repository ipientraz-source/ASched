// Uji logika import dari file absensi (src/impor.ts). Node 24 membaca TypeScript langsung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cocokDs, namaDsBaru, ringkasPerRider } from '../src/impor.ts'

const DS = ['DS ABDESIR', 'DS ALAM SUTRA', 'DS BALIKPAPAN', 'DS GALAXY', 'DS GOWA', 'DS HAYAM WURUK', 'DS PEMURUS', 'DS TIKALA ARES', 'DS UJUNG ASPAL', 'DS UJUNG PANDANG MAKASSAR']
const baris = (kode, nama, ds, n = 1) => ({ baris: n, kode_mtr: kode, nama, no_hp: '', ds, status: '' })

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
