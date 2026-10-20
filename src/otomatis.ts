// Susun jadwal otomatis: membagi shift pagi/siang sesuai kuota DS, adil, dan menjaga kondisi rider.
// Murni (tanpa import) supaya mudah diuji. Hasilnya hanya DRAF — Captain memeriksa lalu menyimpan.
//
// Aturan (urut dari yang paling keras):
//  1. Maksimal `maksHari` hari kerja per MINGGU Senin–Minggu (default 6 → minimal 1 hari libur).
//  2. Maksimal `maksBeruntun` hari kerja BERTURUT-TURUT (default 6), termasuk yang berasal dari periode sebelumnya.
//  3. Shift TIDAK boleh berganti tanpa libur dulu (pagi→siang atau siang→pagi harus melewati minimal 1 hari libur).
//     Kalau kuota tak mungkin terpenuhi tanpa melanggar ini, pelanggaran dilakukan sebagai pilihan terakhir dan dilaporkan (`langgar`).
//  4. Setelah libur, rider melanjutkan shift yang sama seperti sebelum libur (ritme tidur terjaga).
//  5. Keadilan: yang total hari kerjanya paling sedikit didahulukan. Total ikut menghitung `riwayat`
//     (jadwal tersimpan sebelum periode ini, mis. 28 hari terakhir), jadi yang minggu lalu lebih banyak kerja
//     minggu ini kebagian lebih sedikit, walau jadwal dibuat minggu demi minggu.
// ponytail: aturan tetap tanpa preferensi per rider atau libur-permintaan; tambahkan bila Captain membutuhkan.

export type Kurang = { tanggal: string; pagi: number; siang: number }
export type Langgar = { tanggal: string; riderId: string }
export type Draf = { grid: Record<string, string>; kurang: Kurang[]; langgar: Langgar[] }
// Keadaan seorang rider tepat sebelum periode dimulai
export type Riwayat = { hk: number; shiftKemarin: string; shiftTerakhir: string; beruntun: number; pekanBerjalan: number }
export type Opsi = { maksHari?: number; maksBeruntun?: number; riwayat?: Record<string, Riwayat> }

const KOSONG: Riwayat = { hk: 0, shiftKemarin: '', shiftTerakhir: '', beruntun: 0, pekanBerjalan: 0 }
const geser = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
const senin = (d: string) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))
  return t.toISOString().slice(0, 10)
}

// Ringkas jadwal tersimpan sebelum `dari` (mis. 28 hari terakhir) menjadi keadaan awal tiap rider.
export function hitungRiwayat(rows: { rider_id: string; tanggal: string; shift: string }[], riderIds: string[], dari: string): Record<string, Riwayat> {
  const kemarin = geser(dari, -1)
  const awalPekan = senin(dari)
  const out: Record<string, Riwayat> = {}
  for (const id of riderIds) {
    const hari = new Map(rows.filter((r) => r.rider_id === id && r.shift !== 'off' && r.tanggal < dari).map((r) => [r.tanggal, r.shift]))
    let beruntun = 0
    for (let d = kemarin; hari.has(d); d = geser(d, -1)) beruntun++
    const urut = [...hari.keys()].sort()
    out[id] = {
      hk: hari.size,
      shiftKemarin: hari.get(kemarin) ?? '',
      shiftTerakhir: urut.length ? hari.get(urut[urut.length - 1])! : '',
      beruntun,
      pekanBerjalan: urut.filter((t) => t >= awalPekan).length, // hari kerja di minggu yang sama dengan hari pertama periode, sebelum periode
    }
  }
  return out
}

export function buatDraf(riderIds: string[], hari: string[], kuotaPagi: number, kuotaSiang: number, opsi: Opsi = {}): Draf {
  const maksHari = opsi.maksHari ?? 6
  const maksBeruntun = opsi.maksBeruntun ?? 6
  const awal = (id: string) => opsi.riwayat?.[id] ?? KOSONG
  const urutan = new Map(riderIds.map((id, i) => [id, i]))
  const kerja = new Map(riderIds.map((id) => [id, awal(id).hk]))
  const kemarin = new Map(riderIds.map((id) => [id, awal(id).shiftKemarin]))
  const terakhir = new Map(riderIds.map((id) => [id, awal(id).shiftTerakhir]))
  const beruntun = new Map(riderIds.map((id) => [id, awal(id).beruntun]))
  const perPekan = new Map<string, number>() // "riderId|Senin" -> jumlah hari kerja di minggu itu
  if (hari.length) for (const id of riderIds) perPekan.set(`${id}|${senin(hari[0])}`, awal(id).pekanBerjalan)
  const grid: Record<string, string> = {}
  const kurang: Kurang[] = []
  const langgar: Langgar[] = []

  for (const tgl of hari) {
    const pekan = senin(tgl)
    const boleh = riderIds
      .filter((id) => (perPekan.get(`${id}|${pekan}`) ?? 0) < maksHari && beruntun.get(id)! < maksBeruntun)
      .sort((a, b) => kerja.get(a)! - kerja.get(b)! || Number(!!kemarin.get(a)) - Number(!!kemarin.get(b)) || urutan.get(a)! - urutan.get(b)!)
    const sisa = { pagi: kuotaPagi, siang: kuotaSiang }
    const hariIni = new Map<string, 'pagi' | 'siang'>()
    const ambil = (id: string, s: 'pagi' | 'siang') => {
      hariIni.set(id, s)
      sisa[s]--
    }

    // Tahap 1a: pilih SIAPA yang masuk berdasarkan keadilan (hari kerja paling sedikit dulu). Rider yang kemarin masuk hanya
    // bisa melanjutkan shift-nya, jadi jumlah yang melanjutkan tiap shift dibatasi sebesar kuotanya; sisanya libur dan
    // tempatnya diambil rider yang lebih segar. (Tanpa batas ini, pemegang slot siang tak pernah libur.)
    const terpilih: string[] = []
    let lanjutPagi = 0
    let lanjutSiang = 0
    for (const id of boleh) {
      if (terpilih.length >= kuotaPagi + kuotaSiang) break
      const k = kemarin.get(id)
      if (k === 'pagi') {
        if (lanjutPagi >= kuotaPagi) continue
        lanjutPagi++
      } else if (k === 'siang') {
        if (lanjutSiang >= kuotaSiang) continue
        lanjutSiang++
      }
      terpilih.push(id)
    }
    // Tahap 1b: bagi shift. Yang melanjutkan tetap di shift-nya; yang kemarin libur memilih shift terakhirnya (ritme tidur terjaga)
    for (const id of terpilih) {
      const k = kemarin.get(id)
      if (k === 'pagi' || k === 'siang') ambil(id, k)
    }
    for (const id of terpilih) {
      if (hariIni.has(id)) continue
      const pilihan = terakhir.get(id) === 'siang' ? 'siang' : 'pagi' // belum ada riwayat: pagi dulu
      ambil(id, sisa[pilihan] > 0 ? pilihan : pilihan === 'pagi' ? 'siang' : 'pagi')
    }
    // Tahap 2 (darurat): kuota belum terpenuhi → rider yang tersisa boleh pindah shift tanpa libur, dicatat sebagai pelanggaran
    for (const id of boleh) {
      if (sisa.pagi + sisa.siang === 0) break
      if (hariIni.has(id)) continue
      ambil(id, sisa.pagi > 0 ? 'pagi' : 'siang')
      langgar.push({ tanggal: tgl, riderId: id })
    }

    for (const id of riderIds) {
      const s = hariIni.get(id)
      if (s) {
        grid[`${id}|${tgl}`] = s
        kerja.set(id, kerja.get(id)! + 1)
        perPekan.set(`${id}|${pekan}`, (perPekan.get(`${id}|${pekan}`) ?? 0) + 1)
        beruntun.set(id, beruntun.get(id)! + 1)
        terakhir.set(id, s)
        kemarin.set(id, s)
      } else {
        beruntun.set(id, 0)
        kemarin.set(id, '')
      }
    }
    if (sisa.pagi > 0 || sisa.siang > 0) kurang.push({ tanggal: tgl, pagi: sisa.pagi, siang: sisa.siang })
  }
  return { grid, kurang, langgar }
}
