import { useEffect, useState } from 'react'
import { CalendarOff, Copy, FileText, Image as ImageIcon, Sparkles, Sun, Sunrise } from 'lucide-react'
import { sb, today, monday, addDays, hari, useRows, ok, toast, Err, Select, usePage, Pagination, type Ds, type Me, type Rider } from './lib'
import { buatDraf } from './otomatis'
import { Cetak } from './unduh'

const SIKLUS = ['', 'pagi', 'siang'] // urutan ganti saat sel diklik
const NAMA_HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const namaHari = (d: string) => NAMA_HARI[(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7]
const inisial = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

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

// Satu sel jadwal berbentuk pil: Pagi (kuning), Siang (ungu), kosong = libur (garis putus-putus). Dengan `klik` jadi tombol.
function Pil({ v, klik, title, ringkas }: { v: string; klik?: () => void; title?: string; ringkas?: boolean }) {
  const gaya =
    v === 'pagi' ? 'border-warning/30 bg-warning-soft text-warning'
    : v === 'siang' ? 'border-primary/30 bg-primary-soft text-primary-soft-foreground'
    : 'border-dashed border-border text-muted-foreground/50'
  const isi = ringkas
    ? v === 'pagi' ? 'P' : v === 'siang' ? 'S' : '·'
    : v === 'pagi' ? <><Sunrise size={13} />Pagi</> : v === 'siang' ? <><Sun size={13} />Siang</> : <span title="Libur">·</span>
  const kelas = `inline-flex items-center justify-center rounded-lg border font-semibold transition-all ${ringkas ? 'size-7 text-[11px]' : 'w-[4.75rem] gap-1 px-2 py-1.5 text-xs'} ${gaya}`
  return klik ? (
    <button type="button" title={title} onClick={klik} className={`${kelas} hover:scale-105 hover:border-primary ${v ? '' : 'hover:text-primary'}`}>{isi}</button>
  ) : (
    <span className={kelas}>{isi}</span>
  )
}

// Jumlah rider terisi dibanding kuota: hijau = pas, kuning = kurang, merah = kelebihan
function Kuota({ label, n, q, ringkas }: { label: string; n: number; q: number; ringkas?: boolean }) {
  const warna = n === q ? 'text-success' : n < q ? 'text-warning' : 'text-danger'
  return ringkas ? (
    <div title={`${label === 'P' ? 'Pagi' : 'Siang'} ${n}/${q}`} className={`text-center font-mono text-[11px] font-semibold ${warna}`}>{label}{n}</div>
  ) : (
    <div className={`flex items-center justify-between gap-2 font-mono text-[11px] font-semibold ${warna}`}>
      <span>{label}</span>
      <span>{n}/{q}</span>
    </div>
  )
}

// Grid jadwal 1 DS untuk periode bebas. editable = Captain; read-only = Super-admin / Arcon.
export function JadwalGrid({ ds, editable }: { ds: Ds; editable: boolean }) {
  const awal = editable ? addDays(monday(today()), 7) : monday(today())
  const [mode, setMode] = useState<Mode>('minggu')
  const [dari, setDari] = useState(awal)
  const [sampai, setSampai] = useState(addDays(awal, 6))
  const [q, setQ] = useState('')
  const [g, setG] = useState<Record<string, string>>({}) // "riderId|tanggal" -> shift
  const [cetak, setCetak] = useState<'png' | 'pdf' | null>(null)
  const days = rentang(dari, sampai)
  const padat = days.length > 10 // periode panjang: sel dan header diringkas
  const riders = useRows<Rider>(() => sb.from('riders').select('*').eq('ds_id', ds.id).eq('status', 'aktif').order('nama'), [ds.id])
  const j = useRows<Jd>(() => ambilJadwal(ds.id, dari, sampai), [ds.id, dari, sampai])
  useEffect(() => {
    setG(Object.fromEntries(j.rows.map((r) => [`${r.rider_id}|${r.tanggal}`, r.shift])))
  }, [j.rows])

  const cnt = (d: string, s: string) => riders.rows.filter((r) => g[`${r.id}|${d}`] === s).length
  const shown = riders.rows.filter((r) => (r.nama + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()))
  const pg = usePage(shown, [q, ds.id, dari, sampai])
  const adaIsi = days.some((d) => riders.rows.some((r) => g[`${r.id}|${d}`]))
  // lebih dari 6 hari kerja dalam satu minggu Senin–Minggu → tandai merah
  const lebihBatas = (id: string) => {
    const m: Record<string, number> = {}
    for (const d of days) if (g[`${id}|${d}`]) m[monday(d)] = (m[monday(d)] ?? 0) + 1
    return Object.values(m).some((n) => n > 6)
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

  // Draf otomatis: dibagi sesuai kuota DS secara adil. Belum tersimpan sampai Captain klik "Simpan jadwal".
  const susunOtomatis = () => {
    if (ds.kuota_pagi + ds.kuota_siang === 0) return toast('Kuota DS masih 0. Minta Super-admin mengisi kuota pagi dan siang di Kelola DS & Captain.')
    if (!riders.rows.length) return toast('Belum ada rider aktif di DS ini.')
    if (adaIsi && !confirm('Jadwal periode ini sudah ada isinya. Ganti dengan draf otomatis?')) return
    const { grid, kurang } = buatDraf(riders.rows.map((r) => r.id), days, ds.kuota_pagi, ds.kuota_siang)
    setG(grid)
    toast.ok(`Draf jadwal dibuat (${Object.keys(grid).length} shift). Periksa dulu, lalu klik Simpan jadwal.`)
    if (kurang.length) toast(`Rider kurang untuk memenuhi kuota di ${kurang.length} hari (mulai ${hari(kurang[0].tanggal)}). Tambah rider atau kurangi kuota.`)
  }

  // Salin periode sebelumnya yang panjangnya sama (mis. 14 hari terakhir sebelum periode ini)
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
    const rows = Object.entries(g)
      .filter(([k, s]) => s && s !== 'off' && days.includes(k.split('|')[1]))
      .map(([k, shift]) => {
        const [rider_id, tanggal] = k.split('|')
        return { rider_id, tanggal, shift }
      })
    if (await ok(sb.rpc('simpan_jadwal', { p_ds: ds.id, p_dari: days[0], p_sampai: days[days.length - 1], p_rows: rows }))) {
      toast.ok('Jadwal berhasil disimpan')
      j.reload()
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="inp w-56" placeholder="Cari rider / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
          <Pil v="pagi" /> <Pil v="siang" /> <Pil v="" /> <span>libur</span>
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
      <Err msg={riders.err || j.err} />
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
              const kerja = days.filter((d) => g[`${r.id}|${d}`]).length
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
                        <Pil v={v} ringkas={padat} title="Klik untuk mengganti: libur → pagi → siang" klik={editable ? () => setG({ ...g, [k]: SIKLUS[(SIKLUS.indexOf(v) + 1) % SIKLUS.length] }) : undefined} />
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
              <td className="sticky left-0 z-10 bg-muted px-4 py-3 text-xs font-semibold">Jumlah rider / kuota<div className="font-normal text-[11px] text-muted-foreground">P = pagi, S = siang</div></td>
              {days.map((d) => (
                <td key={d} className={`py-2.5 ${padat ? 'px-0.5' : 'px-3'} ${d === today() ? 'bg-primary-soft' : 'bg-muted'}`}>
                  <Kuota label="P" n={cnt(d, 'pagi')} q={ds.kuota_pagi} ringkas={padat} />
                  <Kuota label="S" n={cnt(d, 'siang')} q={ds.kuota_siang} ringkas={padat} />
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
        {editable && <>Warna pada baris kuota: hijau pas, kuning kurang, merah kelebihan. Jadwal tetap bisa disimpan. "Susun otomatis" membagi shift sesuai kuota secara adil (maksimal 6 hari kerja per minggu, jadi ada minimal 1 hari libur). Hasilnya hanya draf: periksa dan ubah dulu, baru klik Simpan jadwal. Pindah periode sebelum menyimpan akan membuang draf. </>}
        Gambar dan PDF dibuat langsung di browser dan tidak disimpan di database.
      </p>
      {cetak && (
        <Cetak
          key={cetak}
          data={{ judul: `Jadwal ${ds.nama}`, days, riders: riders.rows, g, kuotaPagi: ds.kuota_pagi, kuotaSiang: ds.kuota_siang }}
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
