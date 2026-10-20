import { useEffect, useState } from 'react'
import { CalendarOff, Copy, FileText, Image as ImageIcon, Lock, Sparkles, Sun, Sunrise } from 'lucide-react'
import { sb, today, monday, addDays, hari, useRows, ok, toast, Err, Select, usePage, Pagination, type Ds, type Me, type Rider } from './lib'
import { bagiCadangan, buatDraf, cadanganDisarankan, hitungRiwayat, polaAbsen, ringkasanKeadilan, type KuotaHari, type PolaHari, type StatRider } from './otomatis'
import { Cetak } from './unduh'

// urutan ganti saat sel diklik: kosong (libur biasa) → pagi → siang → libur terkunci (cuti/izin yang disepakati)
const SIKLUS = ['', 'pagi', 'siang', 'off']
const NAMA_HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const urutanHari = (d: string) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7 // 0 = Senin
const namaHari = (d: string) => NAMA_HARI[urutanHari(d)]
const inisial = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
const kerjaShift = (v: string | undefined) => v === 'pagi' || v === 'siang'

// ── periode fleksibel: per minggu, per 2 minggu, per bulan, atau rentang tanggal sendiri ──
type Mode = 'minggu' | 'dua' | 'bulan' | 'bebas'
const MAKS_HARI = 63 // batas simpan_jadwal di database (9 minggu)
const awalBulan = (d: string) => d.slice(0, 8) + '01'
const akhirBulan = (d: string) => {
  const t = new Date(awalBulan(d) + 'T00:00:00Z')
  t.setUTCMonth(t.getUTCMonth() + 1, 0)
  return t.toISOString().slice(0, 10)
}
const selisihHari = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
const rentang = (dari: string, sampai: string) => Array.from({ length: Math.min(MAKS_HARI, Math.max(1, selisihHari(dari, sampai) + 1)) }, (_, i) => addDays(dari, i))
function periodeDi(mode: Mode, d: string, panjang: number): [string, string] {
  if (mode === 'minggu') return [monday(d), addDays(monday(d), 6)]
  if (mode === 'dua') return [monday(d), addDays(monday(d), 13)]
  if (mode === 'bulan') return [awalBulan(d), akhirBulan(d)]
  return [d, addDays(d, panjang - 1)]
}

type Jd = { rider_id: string; tanggal: string; shift: string }
type Ak = { rider_id: string; tanggal: string; status: string }
type Kq = { pagi: number; siang: number; cadangan: number } // kebutuhan client per hari + rider cadangan
type KuotaRow = { tanggal: string; kuota_pagi: number; kuota_siang: number; cadangan: number }

// PostgREST membatasi 1000 baris per permintaan; periode panjang + banyak rider bisa melewatinya.
// Ambil bertahap sampai habis — kalau terpotong, menyimpan akan menghapus jadwal yang tidak termuat.
async function ambilJadwal(dsId: string, dari: string, sampai: string) {
  const semua: Jd[] = []
  for (let dariBaris = 0; ; dariBaris += 1000) {
    const { data, error } = await sb
      .from('jadwal')
      .select('rider_id,tanggal,shift')
      .eq('ds_id', dsId)
      .gte('tanggal', dari)
      .lte('tanggal', sampai)
      .order('tanggal')
      .order('rider_id')
      .range(dariBaris, dariBaris + 999)
    if (error) return { data: null, error }
    semua.push(...((data ?? []) as Jd[]))
    if ((data?.length ?? 0) < 1000) return { data: semua, error: null }
  }
}
async function ambilAbsensi(dsId: string, dari: string, sampai: string) {
  const semua: Ak[] = []
  for (let dariBaris = 0; ; dariBaris += 1000) {
    const { data, error } = await sb
      .from('actual_harian')
      .select('rider_id,tanggal,status')
      .eq('ds_id', dsId)
      .gte('tanggal', dari)
      .lte('tanggal', sampai)
      .order('tanggal')
      .order('rider_id')
      .range(dariBaris, dariBaris + 999)
    if (error) return { data: null, error }
    semua.push(...((data ?? []) as Ak[]))
    if ((data?.length ?? 0) < 1000) return { data: semua, error: null }
  }
}

// Satu sel jadwal berbentuk pil: Pagi (kuning), Siang (ungu), libur terkunci (abu + gembok), kosong = libur biasa (garis putus-putus).
function Pil({ v, klik, title, ringkas }: { v: string; klik?: () => void; title?: string; ringkas?: boolean }) {
  const gaya =
    v === 'pagi' ? 'border-warning/30 bg-warning-soft text-warning'
    : v === 'siang' ? 'border-primary/30 bg-primary-soft text-primary-soft-foreground'
    : v === 'off' ? 'border-border bg-muted text-muted-foreground'
    : 'border-dashed border-border text-muted-foreground/50'
  const isi = ringkas
    ? v === 'pagi' ? 'P' : v === 'siang' ? 'S' : v === 'off' ? <Lock size={11} /> : '·'
    : v === 'pagi' ? <><Sunrise size={13} />Pagi</>
    : v === 'siang' ? <><Sun size={13} />Siang</>
    : v === 'off' ? <><Lock size={12} />Libur</>
    : <span title="Libur">·</span>
  const kelas = `inline-flex items-center justify-center rounded-lg border font-semibold transition-all ${ringkas ? 'size-7 text-[11px]' : 'w-[4.75rem] gap-1 px-2 py-1.5 text-xs'} ${gaya}`
  return klik ? (
    <button type="button" title={title} onClick={klik} className={`${kelas} hover:scale-105 hover:border-primary ${v ? '' : 'hover:text-primary'}`}>{isi}</button>
  ) : (
    <span className={kelas} title={v === 'off' ? 'Libur terkunci (cuti/izin yang disepakati)' : undefined}>{isi}</span>
  )
}

// Hijau = pas, kuning = kurang. Kelebihan: biru bila masih dalam jatah cadangan, merah bila melebihi.
const warnaKuota = (n: number, q: number, lebihTotal: number, cad: number) => (n === q ? 'text-success' : n < q ? 'text-warning' : lebihTotal <= cad ? 'text-primary' : 'text-danger')

// Sel baris bawah: jumlah rider terisi vs kebutuhan client hari itu; kebutuhan bisa diedit (Captain / Super-admin)
function SelKuota({ nP, nS, k, editable, ringkas, ubah }: { nP: number; nS: number; k: Kq; editable: boolean; ringkas: boolean; ubah: (f: 'pagi' | 'siang' | 'cadangan', v: string) => void }) {
  const lebih = Math.max(0, nP - k.pagi) + Math.max(0, nS - k.siang)
  const wP = warnaKuota(nP, k.pagi, lebih, k.cadangan)
  const wS = warnaKuota(nS, k.siang, lebih, k.cadangan)
  const input = (f: 'pagi' | 'siang' | 'cadangan', v: number, judul: string) => (
    <input type="number" min={0} title={judul} aria-label={judul} value={v} onChange={(e) => ubah(f, e.target.value)} className={`inp !px-0.5 !py-0 text-center font-mono text-[11px] ${ringkas ? 'w-8' : 'w-10'}`} />
  )
  if (!editable)
    return (
      <>
        <div className={`font-mono text-[11px] font-semibold ${ringkas ? 'text-center' : 'flex justify-between gap-2'} ${wP}`}>{ringkas ? `P${nP}` : <><span>P</span><span>{nP}/{k.pagi}</span></>}</div>
        <div className={`font-mono text-[11px] font-semibold ${ringkas ? 'text-center' : 'flex justify-between gap-2'} ${wS}`}>{ringkas ? `S${nS}` : <><span>S</span><span>{nS}/{k.siang}</span></>}</div>
        {k.cadangan > 0 && <div className="text-center text-[10px] text-muted-foreground" title="Rider cadangan di atas kebutuhan client">+{k.cadangan} cad.</div>}
      </>
    )
  const baris = ringkas ? 'flex flex-col items-center gap-0.5' : 'flex items-center justify-between gap-1'
  return (
    <div className="space-y-1">
      <div className={`${baris} font-mono text-[11px] font-semibold ${wP}`}><span>P{nP}</span>{input('pagi', k.pagi, 'Kebutuhan shift pagi hari ini (sesuai permintaan client)')}</div>
      <div className={`${baris} font-mono text-[11px] font-semibold ${wS}`}><span>S{nS}</span>{input('siang', k.siang, 'Kebutuhan shift siang hari ini (sesuai permintaan client)')}</div>
      <div className={`${baris} font-mono text-[10px] text-muted-foreground`}><span>cad</span>{input('cadangan', k.cadangan, 'Rider cadangan di atas kebutuhan client (opsional)')}</div>
    </div>
  )
}

// Ringkasan keadilan: hari kerja, pagi, siang, akhir pekan, libur tiap rider pada draf/jadwal yang sedang tampil
function PanelKeadilan({ riders, stat }: { riders: Rider[]; stat: Record<string, StatRider> }) {
  const baris = riders.map((r) => ({ r, s: stat[r.id] })).sort((a, b) => b.s.hk - a.s.hk || a.r.nama.localeCompare(b.r.nama))
  const hk = baris.map((b) => b.s.hk)
  const we = baris.map((b) => b.s.akhirPekan)
  const pg = usePage(baris, [riders.length + '|' + hk.join(',') + '|' + we.join(',')])
  const kisaran = (a: number[]) => (a.length ? `${Math.min(...a)}–${Math.max(...a)}` : '–')
  const selisih = (a: number[]) => (a.length ? Math.max(...a) - Math.min(...a) : 0)
  return (
    <details className="card" open>
      <summary className="cursor-pointer font-bold">Ringkasan keadilan</summary>
      <p className="mt-1 text-xs text-muted-foreground">Seberapa rata beban rider di periode ini. Selisih kecil berarti adil; angka ikut berubah saat Anda mengubah jadwal.</p>
      <div className="my-3 flex flex-wrap gap-2 text-xs">
        <span className="badge bg-muted text-foreground/80">Hari kerja per rider: {kisaran(hk)} (selisih {selisih(hk)})</span>
        <span className="badge bg-muted text-foreground/80">Akhir pekan per rider: {kisaran(we)} (selisih {selisih(we)})</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Rider</th><th>Hari kerja</th><th>Pagi</th><th>Siang</th><th>Akhir pekan</th><th>Libur</th></tr></thead>
            <tbody>
              {pg.rows.map(({ r, s }) => (
                <tr key={r.id}>
                  <td>{r.nama} <span className="font-mono text-[11px] text-muted-foreground">{r.kode_mtr}</span></td>
                  <td className="font-mono font-semibold">{s.hk}</td><td className="font-mono">{s.pagi}</td><td className="font-mono">{s.siang}</td>
                  <td className="font-mono">{s.akhirPekan}</td><td className="font-mono text-muted-foreground">{s.libur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...pg} />
      </div>
    </details>
  )
}

// Pola absen nyata (8 minggu terakhir) → saran jumlah rider cadangan per hari dalam seminggu
function PanelPola({ pola, ds }: { pola: PolaHari[] | null; ds: Ds }) {
  const total = ds.kuota_pagi + ds.kuota_siang
  return (
    <details className="card">
      <summary className="cursor-pointer font-bold">Pola absen dan saran cadangan</summary>
      <p className="mt-1 text-xs text-muted-foreground">
        Dihitung dari absensi 8 minggu terakhir yang sudah diisi Captain (alpha + izin + sakit dibanding shift terjadwal). Saran cadangan baru muncul bila datanya cukup (minimal 20 shift per hari dalam seminggu) dan paling banyak 2 rider.
      </p>
      {!pola ? (
        <p className="mt-3 text-sm text-muted-foreground">Memuat…</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {pola.map((p) => {
            const cad = cadanganDisarankan(p, total)
            return (
              <div key={p.hari} className="rounded-xl border border-border p-3 text-center">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{NAMA_HARI[p.hari]}</div>
                <div className={`mt-1 text-xl font-bold ${p.tingkat >= 0.15 ? 'text-danger' : p.tingkat >= 0.08 ? 'text-warning' : ''}`}>{p.terisi ? Math.round(p.tingkat * 100) + '%' : '–'}</div>
                <div className="text-[11px] text-muted-foreground">{p.absen} dari {p.terisi} shift</div>
                <div className={`mt-1 text-xs font-semibold ${cad ? 'text-primary' : 'text-muted-foreground'}`}>{p.terisi < 20 ? 'data belum cukup' : cad ? `+${cad} cadangan` : 'tanpa cadangan'}</div>
              </div>
            )
          })}
        </div>
      )}
    </details>
  )
}

// Grid jadwal 1 DS untuk periode bebas. editable = Captain / Super-admin; read-only = Arcon (dan Super-admin di tampilan lihat).
export function JadwalGrid({ ds, editable }: { ds: Ds; editable: boolean }) {
  const awal = editable ? addDays(monday(today()), 7) : monday(today())
  const [mode, setMode] = useState<Mode>('minggu')
  const [dari, setDari] = useState(awal)
  const [sampai, setSampai] = useState(addDays(awal, 6))
  const [q, setQ] = useState('')
  const [g, setG] = useState<Record<string, string>>({}) // "riderId|tanggal" -> pagi | siang | off
  const [kuota, setKuota] = useState<Record<string, Kq>>({}) // tanggal -> kebutuhan (hanya yang berbeda dari bawaan DS)
  const [cetak, setCetak] = useState<'png' | 'pdf' | null>(null)
  const [pertahankan, setPertahankan] = useState(false) // opsi Susun otomatis: pertahankan pagi/siang yang sudah diisi
  const [pakaiCadangan, setPakaiCadangan] = useState(false) // opsi Susun otomatis: tambah cadangan sesuai pola absen
  const [pola, setPola] = useState<PolaHari[] | null>(null)
  const days = rentang(dari, sampai)
  const padat = days.length > 10 // periode panjang: sel dan header diringkas
  const riders = useRows<Rider>(() => sb.from('riders').select('*').eq('ds_id', ds.id).eq('status', 'aktif').order('nama'), [ds.id])
  const j = useRows<Jd>(() => ambilJadwal(ds.id, dari, sampai), [ds.id, dari, sampai])
  const kRows = useRows<KuotaRow>(() => sb.from('kuota_harian').select('tanggal,kuota_pagi,kuota_siang,cadangan').eq('ds_id', ds.id).gte('tanggal', dari).lte('tanggal', sampai), [ds.id, dari, sampai])
  useEffect(() => {
    setG(Object.fromEntries(j.rows.map((r) => [`${r.rider_id}|${r.tanggal}`, r.shift])))
  }, [j.rows])
  useEffect(() => {
    setKuota(Object.fromEntries(kRows.rows.map((r) => [r.tanggal, { pagi: r.kuota_pagi, siang: r.kuota_siang, cadangan: r.cadangan }])))
  }, [kRows.rows])
  // pola absen 8 minggu terakhir (sebelum hari ini), dipakai untuk saran dan opsi cadangan
  useEffect(() => {
    let batal = false
    ;(async () => {
      const [a, b] = await Promise.all([ambilJadwal(ds.id, addDays(today(), -56), addDays(today(), -1)), ambilAbsensi(ds.id, addDays(today(), -56), addDays(today(), -1))])
      if (!batal && !a.error && !b.error) setPola(polaAbsen(a.data ?? [], b.data ?? []))
    })()
    return () => {
      batal = true
    }
  }, [ds.id])

  const kq = (d: string): Kq => kuota[d] ?? { pagi: ds.kuota_pagi, siang: ds.kuota_siang, cadangan: 0 }
  const cnt = (d: string, s: string) => riders.rows.filter((r) => g[`${r.id}|${d}`] === s).length
  const shown = riders.rows.filter((r) => (r.nama + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()))
  const pg = usePage(shown, [q, ds.id, dari, sampai])
  const adaIsi = days.some((d) => riders.rows.some((r) => kerjaShift(g[`${r.id}|${d}`])))
  const stat = ringkasanKeadilan(g, riders.rows.map((r) => r.id), days)
  // lebih dari 6 hari kerja dalam satu minggu Senin–Minggu → tandai merah
  const lebihBatas = (id: string) => {
    const m: Record<string, number> = {}
    for (const d of days) if (kerjaShift(g[`${id}|${d}`])) m[monday(d)] = (m[monday(d)] ?? 0) + 1
    return Object.values(m).some((n) => n > 6)
  }
  const ubahKuota = (d: string, f: 'pagi' | 'siang' | 'cadangan', v: string) => {
    const n = Math.max(0, Math.min(f === 'cadangan' ? 100 : 500, Math.floor(+v || 0)))
    setKuota((s) => ({ ...s, [d]: { ...(s[d] ?? { pagi: ds.kuota_pagi, siang: ds.kuota_siang, cadangan: 0 }), [f]: n } }))
  }

  // ── ganti periode ──
  const pasang = (a: string, b: string) => {
    setDari(a)
    setSampai(b)
  }
  const gantiMode = (m: string) => {
    const baru = m as Mode
    setMode(baru)
    if (baru !== 'bebas') pasang(...periodeDi(baru, dari, days.length))
  }
  const ubahTanggal = (a: string, b: string) => {
    if (!a || !b) return
    if (b < a) return toast('Tanggal "sampai" tidak boleh lebih awal dari tanggal "dari".')
    if (selisihHari(a, b) + 1 > MAKS_HARI) return toast(`Periode paling lama ${MAKS_HARI} hari (9 minggu).`)
    setMode('bebas')
    pasang(a, b)
  }
  // Mode minggu / 2 minggu / bulan: memilih tanggal apa pun menampilkan minggu atau bulan yang memuat tanggal itu.
  // Mode rentang sendiri: tanggal dipakai apa adanya.
  const ubahDari = (tgl: string) => (mode === 'bebas' ? ubahTanggal(tgl, sampai < tgl ? tgl : sampai) : pasang(...periodeDi(mode, tgl, days.length)))

  // Draf otomatis: dibagi sesuai kebutuhan tiap hari secara adil. Belum tersimpan sampai klik "Simpan jadwal".
  // Libur terkunci (gembok) SELALU dihormati; pagi/siang yang sudah diisi hanya dipertahankan bila opsinya dicentang.
  const susunOtomatis = async () => {
    if (!riders.rows.length) return toast('Belum ada rider aktif di DS ini.')
    if (days.every((d) => kq(d).pagi + kq(d).siang === 0)) return toast('Kebutuhan masih 0 untuk semua hari. Isi kebutuhan di baris kuota, atau minta Super-admin mengisi kuota DS di Kelola DS & Captain.')
    if (adaIsi && !pertahankan && !confirm('Jadwal periode ini sudah ada isinya. Ganti dengan draf otomatis? (Libur terkunci tetap dihormati.)')) return
    // Ingat 28 hari terakhir yang sudah tersimpan: keadilan hari kerja berlanjut lintas minggu, dan shift
    // tidak berganti tanpa libur dulu walau melewati batas periode.
    const { data, error } = await ambilJadwal(ds.id, addDays(dari, -28), addDays(dari, -1))
    if (error) return toast(error.message)
    const ids = riders.rows.map((r) => r.id)
    const tetap: Record<string, 'pagi' | 'siang' | 'off'> = {}
    for (const [k, v] of Object.entries(g)) if (days.includes(k.split('|')[1]) && (v === 'off' || (pertahankan && (v === 'pagi' || v === 'siang')))) tetap[k] = v as 'pagi' | 'siang' | 'off'
    // kebutuhan efektif per hari = kebutuhan client + cadangan (manual, atau saran pola absen bila opsinya dicentang)
    const kuotaBaru: Record<string, Kq> = { ...kuota }
    const kuotaHari: Record<string, KuotaHari> = {}
    for (const d of days) {
      let k = kq(d)
      if (pakaiCadangan && pola) {
        const saran = cadanganDisarankan(pola[urutanHari(d)], k.pagi + k.siang)
        if (saran > k.cadangan) k = { ...k, cadangan: saran }
      }
      kuotaBaru[d] = k
      kuotaHari[d] = bagiCadangan({ pagi: k.pagi, siang: k.siang }, k.cadangan)
    }
    const { grid, kurang, langgar } = buatDraf(ids, days, ds.kuota_pagi, ds.kuota_siang, { riwayat: hitungRiwayat(data ?? [], ids, dari), kuotaHari, tetap })
    const kunci = Object.fromEntries(Object.entries(tetap).filter(([, v]) => v === 'off')) // libur terkunci tetap tampil
    setG({ ...grid, ...kunci })
    setKuota(kuotaBaru)
    const hk = ids.map((id) => days.filter((d) => grid[`${id}|${d}`]).length)
    toast.ok(`Draf jadwal dibuat: ${Object.keys(grid).length} shift, hari kerja per rider ${Math.min(...hk)}–${Math.max(...hk)}. Periksa dulu, lalu klik Simpan jadwal.`)
    if (pakaiCadangan && !pola?.some((p) => p.terisi >= 20)) toast('Data absensi belum cukup untuk menyarankan cadangan, jadi tidak ada cadangan yang ditambahkan.')
    if (kurang.length) toast(`Rider kurang untuk memenuhi kebutuhan di ${kurang.length} hari (mulai ${hari(kurang[0].tanggal)}). Tambah rider atau kurangi kebutuhan.`)
    if (langgar.length) toast(`${langgar.length} kali rider terpaksa pindah shift tanpa libur dulu supaya kebutuhan terpenuhi (mulai ${hari(langgar[0].tanggal)}). Periksa lagi jadwalnya.`)
  }

  // Salin periode sebelumnya yang panjangnya sama (mis. 14 hari terakhir sebelum periode ini), termasuk libur terkunci
  const salinSebelumnya = async () => {
    const n = days.length
    const { data, error } = await ambilJadwal(ds.id, addDays(dari, -n), addDays(dari, -1))
    if (error) return toast(error.message)
    const aktif = new Set(riders.rows.map((r) => r.id)) // rider yang sudah pindah/nonaktif tidak ikut disalin
    const baru: Record<string, string> = {}
    for (const r of data ?? []) if (aktif.has(r.rider_id)) baru[`${r.rider_id}|${addDays(r.tanggal, n)}`] = r.shift
    if (!Object.keys(baru).length) return toast('Periode sebelumnya belum ada jadwal untuk disalin.')
    if (adaIsi && !confirm('Jadwal periode ini sudah ada isinya. Ganti dengan salinan periode sebelumnya?')) return
    setG(baru)
    toast.ok('Jadwal periode sebelumnya disalin. Periksa dulu, lalu klik Simpan jadwal.')
  }

  const save = async () => {
    // kebutuhan harian disimpan lebih dulu (server hanya menyimpan hari yang berbeda dari bawaan DS)
    const rowsKuota = days.map((d) => ({ tanggal: d, ...kq(d) }))
    if (!(await ok(sb.rpc('simpan_kuota', { p_ds: ds.id, p_dari: days[0], p_sampai: days[days.length - 1], p_rows: rowsKuota })))) return
    const rows = Object.entries(g)
      .filter(([k, s]) => s && days.includes(k.split('|')[1]))
      .map(([k, shift]) => {
        const [rider_id, tanggal] = k.split('|')
        return { rider_id, tanggal, shift }
      })
    if (await ok(sb.rpc('simpan_jadwal', { p_ds: ds.id, p_dari: days[0], p_sampai: days[days.length - 1], p_rows: rows }))) {
      toast.ok('Jadwal berhasil disimpan')
      j.reload()
      kRows.reload()
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select className="w-44" value={mode} onChange={gantiMode} opsi={[{ value: 'minggu', label: 'Per minggu' }, { value: 'dua', label: 'Per 2 minggu' }, { value: 'bulan', label: 'Per bulan' }, { value: 'bebas', label: 'Rentang sendiri' }]} />
        <button className="btn2" onClick={() => pasang(...periodeDi(mode, today(), days.length))}>Hari ini</button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Dari <input type="date" className="inp" value={dari} onChange={(e) => e.target.value && ubahDari(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Sampai <input type="date" className="inp" value={sampai} min={dari} onChange={(e) => e.target.value && ubahTanggal(dari, e.target.value)} />
        </label>
        <span className="text-xs text-muted-foreground">{days.length} hari</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className="inp w-56" placeholder="Cari rider / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
          <Pil v="pagi" /> <Pil v="siang" /> <Pil v="off" /> <Pil v="" /> <span>libur</span>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn2" disabled={!!cetak || !riders.rows.length} onClick={() => setCetak('png')} title="Unduh jadwal periode ini sebagai gambar"><ImageIcon size={14} />{cetak === 'png' ? 'Membuat…' : 'Unduh gambar'}</button>
          <button className="btn2" disabled={!!cetak || !riders.rows.length} onClick={() => setCetak('pdf')} title="Unduh jadwal periode ini sebagai PDF"><FileText size={14} />{cetak === 'pdf' ? 'Membuat…' : 'Unduh PDF'}</button>
          {editable && (
            <>
              <button className="btn2" onClick={salinSebelumnya}><Copy size={14} />Salin periode sebelumnya</button>
              <button className="btn2" onClick={susunOtomatis}><Sparkles size={14} />Susun otomatis</button>
              <button className="btn" onClick={save}>Simpan jadwal</button>
            </>
          )}
        </div>
      </div>
      {editable && (
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Opsi Susun otomatis:</span>
          <label className="flex cursor-pointer items-center gap-1.5" title="Pagi/siang yang sudah Anda isi tidak diubah; otomatis hanya mengisi sisanya. Libur terkunci (gembok) selalu dihormati, dicentang atau tidak.">
            <input type="checkbox" checked={pertahankan} onChange={(e) => setPertahankan(e.target.checked)} /> Pertahankan shift yang sudah diisi
          </label>
          <label className="flex cursor-pointer items-center gap-1.5" title="Menambah rider di atas kebutuhan client pada hari yang sering ada absen, berdasarkan pola 8 minggu terakhir.">
            <input type="checkbox" checked={pakaiCadangan} onChange={(e) => setPakaiCadangan(e.target.checked)} /> Tambah cadangan sesuai pola absen
          </label>
        </div>
      )}
      <Err msg={riders.err || j.err || kRows.err} />
      {!editable && !j.rows.length && riders.rows.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          <CalendarOff size={20} className="shrink-0" />
          Belum ada jadwal di periode ini. Captain DS ini belum menyusunnya.
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-60 border-b border-border bg-card px-4 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rider</th>
              {days.map((d, i) => {
                const hariIni = d === today()
                const akhirPekan = ['Sab', 'Min'].includes(namaHari(d))
                const tandaBulan = i === 0 || d.slice(8) === '01'
                return (
                  <th key={d} className={`border-b border-border py-2 text-center ${padat ? 'px-0.5' : 'px-2'} ${hariIni ? 'bg-primary-soft' : akhirPekan ? 'bg-muted/50' : 'bg-card'}`}>
                    <div className="h-3 text-[9px] font-semibold uppercase text-primary">{tandaBulan ? NAMA_BULAN[+d.slice(5, 7) - 1] : ''}</div>
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{namaHari(d)}</div>
                    <div className={`mx-auto mt-0.5 flex items-center justify-center rounded-full font-bold ${padat ? 'size-7 text-xs' : 'size-8 text-sm'} ${hariIni ? 'bg-primary text-primary-foreground' : ''}`}>{d.slice(8)}</div>
                  </th>
                )
              })}
              <th className="border-b border-border bg-card px-3 py-3 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Hari kerja</th>
            </tr>
          </thead>
          <tbody>
            {pg.rows.map((r) => {
              const kerja = days.filter((d) => kerjaShift(g[`${r.id}|${d}`])).length
              return (
                <tr key={r.id} className="group">
                  <td className="sticky left-0 z-10 whitespace-nowrap border-b border-border/60 bg-card px-4 py-2 transition-colors group-hover:bg-primary-soft">
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{inisial(r.nama)}</span>
                      <div className="leading-tight">
                        <div className="font-medium">{r.nama}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{r.kode_mtr}</div>
                      </div>
                    </div>
                  </td>
                  {days.map((d) => {
                    const k = `${r.id}|${d}`
                    const v = g[k] ?? ''
                    return (
                      <td key={d} className={`border-b border-border/60 py-2 text-center transition-colors group-hover:bg-primary-soft/60 ${padat ? 'px-0.5' : 'px-2'} ${d === today() ? 'bg-primary-soft/40' : ''}`}>
                        <Pil v={v} ringkas={padat} title="Klik untuk mengganti: libur → pagi → siang → libur terkunci (cuti/izin, tidak diisi otomatis)" klik={editable ? () => setG({ ...g, [k]: SIKLUS[(SIKLUS.indexOf(v) + 1) % SIKLUS.length] }) : undefined} />
                      </td>
                    )
                  })}
                  <td className="border-b border-border/60 px-3 py-2 text-center font-mono text-sm transition-colors group-hover:bg-primary-soft/60">
                    <span className={lebihBatas(r.id) ? 'font-bold text-danger' : 'font-semibold'} title={lebihBatas(r.id) ? 'Ada minggu dengan lebih dari 6 hari kerja' : undefined}>{kerja}</span>
                    <span className="text-muted-foreground">/{days.length}</span>
                  </td>
                </tr>
              )
            })}
            {!pg.rows.length && (
              <tr><td colSpan={days.length + 2} className="px-4 py-10 text-center text-muted-foreground">{riders.rows.length ? 'Tidak ada rider yang cocok dengan pencarian.' : 'Belum ada rider aktif di DS ini.'}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 z-10 bg-muted px-4 py-3 text-xs font-semibold">
                Terisi / kebutuhan client
                <div className="font-normal text-[11px] text-muted-foreground">P = pagi, S = siang, cad = rider cadangan{editable ? '. Angka kebutuhan bisa diubah per hari.' : ''}</div>
              </td>
              {days.map((d) => (
                <td key={d} className={`py-2.5 ${padat ? 'px-0.5' : 'px-3'} ${d === today() ? 'bg-primary-soft' : 'bg-muted'}`}>
                  <SelKuota nP={cnt(d, 'pagi')} nS={cnt(d, 'siang')} k={kq(d)} editable={editable} ringkas={padat} ubah={(f, v) => ubahKuota(d, f, v)} />
                </td>
              ))}
              <td className="bg-muted" />
            </tr>
          </tfoot>
        </table>
        </div>
        <Pagination {...pg} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {editable && (
          <>
            Warna baris kebutuhan: hijau pas, kuning kurang, biru lebih tapi masih dalam jatah cadangan, merah kelebihan. Jadwal tetap bisa disimpan. Klik sel untuk mengganti: libur, pagi, siang, lalu <b>libur terkunci</b> (gembok) untuk cuti atau izin yang sudah disepakati, yang tidak akan diisi otomatis. "Susun otomatis" membagi shift sesuai kebutuhan tiap hari secara adil dan membaca jadwal 28 hari sebelumnya yang sudah tersimpan (simpan periode sebelumnya dulu). Aturannya: maksimal 6 hari kerja per minggu dan 6 hari berturut-turut, shift hanya berganti setelah libur, dan setelah libur rider melanjutkan shift sebelumnya. Hasilnya hanya draf: periksa dan ubah dulu, baru klik Simpan jadwal. Pindah periode sebelum menyimpan akan membuang draf.{' '}
          </>
        )}
        Gambar dan PDF dibuat langsung di browser dan tidak disimpan di database.
      </p>
      {riders.rows.length > 0 && (
        <div className="mt-4">
          <PanelKeadilan riders={riders.rows} stat={stat} />
          <PanelPola pola={pola} ds={ds} />
        </div>
      )}
      {cetak && (
        <Cetak
          key={cetak}
          data={{ judul: `Jadwal ${ds.nama}`, days, riders: riders.rows, g, kuota: Object.fromEntries(days.map((d) => [d, kq(d)])) }}
          mode={cetak}
          onSelesai={(galat) => {
            const jenis = cetak === 'png' ? 'Gambar' : 'PDF'
            setCetak(null)
            if (galat) toast(`${jenis} gagal dibuat: ${galat}`)
            else toast.ok(`${jenis} jadwal sudah diunduh.`)
          }}
        />
      )}
    </div>
  )
}

export function JadwalDs({ ds }: { me: Me; ds: Ds | null }) {
  return ds ? <JadwalGrid key={ds.id} ds={ds} editable /> : <p>Anda belum ditunjuk sebagai Captain di DS mana pun.</p>
}

// Super-admin (editable, akses penuh) / Arcon (hanya lihat): jadwal DS mana pun
export function JadwalSemua({ daftar, editable = false }: { daftar?: Ds[]; editable?: boolean }) {
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const rows = daftar ?? dsl.rows // Arcon: hanya DS yang dipegang; Super-admin: semua DS
  const [id, setId] = useState('')
  const ds = rows.find((d) => d.id === (id || rows[0]?.id))
  return (
    <div>
      <Select className="mb-3 w-72 max-w-full" value={ds?.id ?? ''} onChange={setId} placeholder="Pilih DS" opsi={rows.map((d) => ({ value: d.id, label: d.nama }))} />
      {ds ? <JadwalGrid key={ds.id} ds={ds} editable={editable} /> : <p className="text-muted-foreground">Belum ada DS.</p>}
    </div>
  )
}
