// Fulfillment rate: berapa persen kebutuhan client yang benar-benar terpenuhi di lapangan, per hari dan per DS.
// Murni (tanpa import) supaya mudah diuji. Bahannya baris dari laporan_fulfillment (satu baris per DS per tanggal).
//
// Rumus per DS per hari:
//   kebutuhan = kebutuhan client pada shift yang SUDAH dilaporkan Captain (pagi dan/atau siang)
//   terpenuhi = rider yang bekerja (hadir, tukar, pengganti), dibatasi kebutuhan per shift;
//               pengganti yang tidak menggantikan siapa pun (terpenuhi_lain) menutup kekurangan shift mana pun
//   rate      = terpenuhi / kebutuhan
// Kelebihan rider di atas kebutuhan TIDAK menaikkan rate (maksimal 100% per shift): ditampilkan terpisah sebagai "kelebihan".
// Shift yang belum dilaporkan tidak dihitung 0% (itu bukan kekurangan rider, itu laporan yang belum masuk): ditandai "belum dilaporkan".
// Shift siang hari ini baru dianggap jatuh tempo setelah pukul 22:00 WIB (siang_jatuh_tempo dari database).

export type BarisFulfillment = {
  tanggal: string
  ds_id: string
  ds_nama: string
  kebutuhan_pagi: number
  kebutuhan_siang: number
  terpenuhi_pagi: number
  terpenuhi_siang: number
  terpenuhi_lain: number
  lapor_pagi: boolean
  lapor_siang: boolean
  siang_jatuh_tempo: boolean
}

export type HasilFulfillment = {
  kebutuhan: number // hanya shift yang sudah dilaporkan
  terpenuhi: number
  kelebihan: number // rider di atas kebutuhan, tidak ikut menaikkan rate
  rate: number | null // 0..1; null bila belum ada shift yang dilaporkan
  belumLapor: ('pagi' | 'siang')[] // shift yang jatuh tempo tetapi belum dilaporkan
}

// Satu DS pada satu hari
export function hitungDsHari(b: BarisFulfillment): HasilFulfillment {
  const belumLapor: ('pagi' | 'siang')[] = []
  if (!b.lapor_pagi && b.kebutuhan_pagi > 0) belumLapor.push('pagi')
  if (!b.lapor_siang && b.kebutuhan_siang > 0 && b.siang_jatuh_tempo) belumLapor.push('siang')

  const kp = b.lapor_pagi ? b.kebutuhan_pagi : 0
  const ks = b.lapor_siang ? b.kebutuhan_siang : 0
  const tp = b.lapor_pagi ? b.terpenuhi_pagi : 0
  const ts = b.lapor_siang ? b.terpenuhi_siang : 0
  const okP = Math.min(kp, tp)
  const okS = Math.min(ks, ts)
  const kurang = kp - okP + (ks - okS)
  const okLain = Math.min(kurang, b.terpenuhi_lain)
  const kebutuhan = kp + ks
  const terpenuhi = okP + okS + okLain
  return {
    kebutuhan,
    terpenuhi,
    kelebihan: tp - okP + (ts - okS) + (b.terpenuhi_lain - okLain),
    rate: kebutuhan > 0 ? terpenuhi / kebutuhan : null,
    belumLapor,
  }
}

export type HariFulfillment = HasilFulfillment & { tanggal: string; belumDs: string[] }
export type DsFulfillment = HasilFulfillment & { ds_id: string; ds_nama: string; hariBelumLapor: number }

const jumlah = (xs: HasilFulfillment[]): Omit<HasilFulfillment, 'belumLapor'> => {
  const kebutuhan = xs.reduce((a, x) => a + x.kebutuhan, 0)
  const terpenuhi = xs.reduce((a, x) => a + x.terpenuhi, 0)
  return { kebutuhan, terpenuhi, kelebihan: xs.reduce((a, x) => a + x.kelebihan, 0), rate: kebutuhan > 0 ? terpenuhi / kebutuhan : null }
}

// Ringkasan: per hari (semua DS yang ada di baris), per DS (seluruh periode), dan total periode
export function ringkasFulfillment(rows: BarisFulfillment[]) {
  const perHari = new Map<string, { baris: HasilFulfillment[]; belumDs: string[] }>()
  const perDs = new Map<string, { nama: string; baris: HasilFulfillment[]; hari: number }>()
  for (const b of rows) {
    const h = hitungDsHari(b)
    const hari = perHari.get(b.tanggal) ?? { baris: [], belumDs: [] }
    hari.baris.push(h)
    if (h.belumLapor.length) hari.belumDs.push(`${b.ds_nama} (${h.belumLapor.join(' dan ')})`)
    perHari.set(b.tanggal, hari)
    const d = perDs.get(b.ds_id) ?? { nama: b.ds_nama, baris: [], hari: 0 }
    d.baris.push(h)
    if (h.belumLapor.length) d.hari++
    perDs.set(b.ds_id, d)
  }
  const harian: HariFulfillment[] = [...perHari.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tanggal, v]) => ({ tanggal, ...jumlah(v.baris), belumLapor: [...new Set(v.baris.flatMap((x) => x.belumLapor))], belumDs: v.belumDs }))
  const dsList: DsFulfillment[] = [...perDs.entries()]
    .map(([ds_id, v]) => ({ ds_id, ds_nama: v.nama, ...jumlah(v.baris), belumLapor: [], hariBelumLapor: v.hari }))
    .sort((a, b) => a.ds_nama.localeCompare(b.ds_nama))
  const semua = [...perHari.values()].flatMap((v) => v.baris)
  return { harian, perDs: dsList, total: jumlah(semua) }
}

// Warna penilaian: >= 95% baik, 80-95% perlu perhatian, di bawah 80% kurang
export const tingkatFulfillment = (rate: number | null) => (rate === null ? 'kosong' : rate >= 0.95 ? 'baik' : rate >= 0.8 ? 'perhatian' : 'kurang')
export const persen = (rate: number | null) => (rate === null ? '–' : `${Math.round(rate * 100)}%`)
