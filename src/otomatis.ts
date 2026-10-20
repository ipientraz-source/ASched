// Susun jadwal otomatis: membagi shift pagi/siang sesuai kuota DS, seadil mungkin.
// Murni (tanpa import) supaya mudah diuji. Hasilnya hanya DRAF — Captain memeriksa lalu menyimpan.
//
// Aturan:
//  - tiap hari: `kuotaPagi` rider di pagi dan `kuotaSiang` rider di siang
//  - tiap rider maksimal `maksHari` hari kerja per MINGGU Senin–Minggu (default 6 → minimal 1 hari libur);
//    periode boleh bebas (beberapa hari, 2 minggu, sebulan) — batas dihitung per minggu kalender di dalam periode
//  - yang sudah paling sedikit kerja didahulukan; yang kemarin libur didahulukan dari yang kemarin masuk
//  - rider yang lebih sering kebagian pagi tetap diprioritaskan pagi (shift cenderung konsisten)
// ponytail: aturan tetap tanpa preferensi per rider; tambahkan field preferensi/libur-permintaan bila Captain membutuhkan.

export type Kurang = { tanggal: string; pagi: number; siang: number }
export type Draf = { grid: Record<string, string>; kurang: Kurang[] }

const senin = (d: string) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))
  return t.toISOString().slice(0, 10)
}

export function buatDraf(riderIds: string[], hari: string[], kuotaPagi: number, kuotaSiang: number, maksHari = 6): Draf {
  const perPekan = new Map<string, number>() // "riderId|Senin" -> jumlah hari kerja di minggu itu
  const urutan = new Map(riderIds.map((id, i) => [id, i]))
  const kerja = new Map(riderIds.map((id) => [id, 0]))
  const nPagi = new Map(riderIds.map((id) => [id, 0]))
  const nSiang = new Map(riderIds.map((id) => [id, 0]))
  const grid: Record<string, string> = {}
  const kurang: Kurang[] = []
  let kemarin = new Set<string>()

  for (const tgl of hari) {
    const pilih = riderIds
      .filter((id) => (perPekan.get(`${id}|${senin(tgl)}`) ?? 0) < maksHari)
      .sort((a, b) => kerja.get(a)! - kerja.get(b)! || Number(kemarin.has(a)) - Number(kemarin.has(b)) || urutan.get(a)! - urutan.get(b)!)
      .slice(0, kuotaPagi + kuotaSiang)
      .sort((a, b) => nPagi.get(b)! - nSiang.get(b)! - (nPagi.get(a)! - nSiang.get(a)!) || urutan.get(a)! - urutan.get(b)!)

    const hariIni = new Set<string>()
    pilih.forEach((id, i) => {
      const shift = i < kuotaPagi ? 'pagi' : 'siang'
      grid[`${id}|${tgl}`] = shift
      kerja.set(id, kerja.get(id)! + 1)
      perPekan.set(`${id}|${senin(tgl)}`, (perPekan.get(`${id}|${senin(tgl)}`) ?? 0) + 1)
      ;(shift === 'pagi' ? nPagi : nSiang).set(id, (shift === 'pagi' ? nPagi : nSiang).get(id)! + 1)
      hariIni.add(id)
    })

    const dapatPagi = Math.min(kuotaPagi, pilih.length)
    const dapatSiang = pilih.length - dapatPagi
    if (dapatPagi < kuotaPagi || dapatSiang < kuotaSiang) kurang.push({ tanggal: tgl, pagi: kuotaPagi - dapatPagi, siang: kuotaSiang - dapatSiang })
    kemarin = hariIni
  }
  return { grid, kurang }
}
