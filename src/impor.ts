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
