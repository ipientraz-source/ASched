// Logika import rider dari file absensi (export sistem): murni, tanpa import, supaya mudah diuji.
// File absensi punya banyak baris per rider dan menamai DS dengan nama lokasi ("Dark Store Alfagift - Galaxy"),
// sedangkan aplikasi memakai satu baris per rider dan nama DS sendiri ("DS GALAXY").

export type Baris = { baris: number; kode_mtr: string; nama: string; no_hp: string; ds: string; status: string }

// Buang awalan lokasi yang umum, lalu sisakan huruf/angka saja untuk dibandingkan
const bersih = (s: string) =>
  s.toUpperCase().replace(/DARK\s*STORE(\s*ALFAGIFT)?\s*-?/g, '').replace(/^\s*DS\s+/, '')
export const normDs = (s: string) => bersih(s).replace(/[^A-Z0-9]/g, '')

// Jumlah huruf yang berbeda (disisipkan / dihapus / diganti) antara dua kata
function jarak(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

// Cocokkan nama lokasi ke DS yang sudah ada. null = tidak ada yang cocok.
// Cocok bila: sama persis, atau salah satunya memuat yang lain (min. 4 huruf), atau beda satu huruf pada nama
// yang cukup panjang (min. 7 huruf, mis. "Alam Sutera" vs "ALAM SUTRA"). Nama pendek yang salah ketik
// ("Galaxi" vs "GALAXY") sengaja TIDAK cocok agar tidak salah sambung.
export function cocokDs(lokasi: string, namaDs: string[]): string | null {
  const a = normDs(lokasi)
  if (!a) return null
  const dekat = (x: string, y: string) => Math.abs(normDs(x).length - normDs(y).length)
  const urut = (l: string[]) => l.sort((x, y) => dekat(x, lokasi) - dekat(y, lokasi))
  const pasti = namaDs.filter((n) => {
    const b = normDs(n)
    return b === a || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))
  })
  if (pasti.length) return urut(pasti)[0]
  const mirip = namaDs.filter((n) => {
    const b = normDs(n)
    return Math.min(a.length, b.length) >= 7 && jarak(a, b) <= 1
  })
  return urut(mirip)[0] ?? null
}

// Nama DS yang diusulkan untuk lokasi yang belum ada: "Dark Store - Jelupang" → "DS JELUPANG"
export const namaDsBaru = (lokasi: string) => 'DS ' + bersih(lokasi).replace(/\s+/g, ' ').trim()

// ───────── impor data motor (mis. file "DS Location, License Plate, VIN") ─────────
export type BarisMotor = { baris: number; lokasi: string; plat: string; vin: string }
export type HasilMotor = { baris: number; lokasi: string; ds: string | null; dsBaru: string | null; plat: string; vin: string; kode: string; tahun: number | null; masalah: string }

const ALIAS_MOTOR = {
  lokasi: ['ds location', 'lokasi', 'lokasi ds', 'ds', 'nama ds', 'dark store'],
  plat: ['license plate', 'plat', 'plat nomor', 'nopol', 'no polisi', 'nomor polisi'],
  vin: ['vin', 'no rangka', 'nomor rangka', 'chassis', 'no chassis'],
}
const kecil = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Tabel CSV → baris motor. Baris tanpa plat dan VIN (mis. "Grand Total") dibuang. VIN boleh tidak ada.
export function bacaCsvMotor(tabel: string[][]): { baris: BarisMotor[]; galat: string } {
  const [h = [], ...isi] = tabel
  const kol = (a: string[]) => h.findIndex((x) => a.includes(kecil(x)))
  const [iL, iP, iV] = [kol(ALIAS_MOTOR.lokasi), kol(ALIAS_MOTOR.plat), kol(ALIAS_MOTOR.vin)]
  if (iL < 0 || iP < 0) return { baris: [], galat: 'Kolom wajib tidak ditemukan: lokasi DS dan plat nomor (mis. "DS Location" dan "License Plate").' }
  const baris = isi
    .map((c, i) => ({ baris: i + 2, lokasi: (c[iL] ?? '').trim(), plat: (c[iP] ?? '').trim(), vin: iV >= 0 ? (c[iV] ?? '').trim() : '' }))
    .filter((b) => b.plat || b.vin)
  return { baris, galat: '' }
}

// "B4672SWN" → "B 4672 SWN"; huruf besar, spasi seragam
export function normPlat(p: string): string {
  const m = p.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^([A-Z]{1,2})(\d{1,4})([A-Z]{0,3})$/)
  return m ? [m[1], m[2], m[3]].filter(Boolean).join(' ') : p.trim().toUpperCase().replace(/\s+/g, ' ')
}

// Karakter ke-10 VIN = kode tahun model (standar): S = 2025, T = 2026, dst. Hanya 2010-2030.
const KODE_TAHUN = 'ABCDEFGHJKLMNPRSTVWXY'
export function tahunDariVin(vin: string): number | null {
  const c = (vin[9] ?? '').toUpperCase()
  const i = c ? KODE_TAHUN.indexOf(c) : -1
  return i < 0 ? null : 2010 + i
}

// Cocokkan ke DS yang ada, tandai masalah (plat/VIN sudah terdaftar atau dobel, VIN tidak valid, DS belum ada).
// Kode motor = plat nomor (unik dan dikenal tim), karena file tidak punya kolom kode.
export function siapkanMotor(baris: BarisMotor[], namaDs: string[], ada: { plat: string[]; vin: string[]; kode: string[] }, buatDsBaru: boolean): HasilMotor[] {
  const platAda = new Set([...ada.plat, ...ada.kode].map((x) => x.toUpperCase()))
  const vinAda = new Set(ada.vin.map((v) => v.toUpperCase()))
  const hitung = (l: string[]) => l.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())
  const platFile = hitung(baris.map((b) => normPlat(b.plat)))
  const vinFile = hitung(baris.map((b) => b.vin.toUpperCase().replace(/\s+/g, '')).filter(Boolean))
  return baris.map((b) => {
    const plat = normPlat(b.plat)
    const vin = b.vin.toUpperCase().replace(/\s+/g, '')
    const ds = cocokDs(b.lokasi, namaDs)
    const dsBaru = !ds && b.lokasi ? namaDsBaru(b.lokasi) : null
    const masalah =
      !plat ? 'Plat nomor kosong'
      : !b.lokasi ? 'Lokasi DS kosong'
      : vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? 'VIN harus 17 karakter (tanpa huruf I, O, Q)'
      : platAda.has(plat) ? 'Plat sudah terdaftar'
      : vin && vinAda.has(vin) ? 'VIN sudah terdaftar'
      : (platFile.get(plat) ?? 0) > 1 ? 'Plat dobel di file'
      : vin && (vinFile.get(vin) ?? 0) > 1 ? 'VIN dobel di file'
      : dsBaru && !buatDsBaru ? 'DS belum ada'
      : ''
    return { baris: b.baris, lokasi: b.lokasi, ds, dsBaru, plat, vin, kode: plat, tahun: tahunDariVin(vin), masalah }
  })
}

// Banyak baris per rider → satu baris per rider. DS = lokasi paling sering muncul; nama dirapikan.
// Baris tanpa kode tetap dibawa supaya server menolaknya dengan pesan jelas.
export function ringkasPerRider(rows: Baris[]): Baris[] {
  const grup = new Map<string, { pertama: Baris; ds: Map<string, number> }>()
  const tanpaKode: Baris[] = []
  for (const r of rows) {
    const k = r.kode_mtr.trim().toUpperCase()
    if (!k) {
      tanpaKode.push(r)
      continue
    }
    const g = grup.get(k) ?? { pertama: r, ds: new Map<string, number>() }
    if (r.ds) g.ds.set(r.ds, (g.ds.get(r.ds) ?? 0) + 1)
    grup.set(k, g)
  }
  const hasil = [...grup.values()].map(({ pertama, ds }) => ({
    ...pertama,
    nama: pertama.nama.replace(/\s+/g, ' ').trim(),
    ds: [...ds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
  }))
  return [...hasil, ...tanpaKode]
}
