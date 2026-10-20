import { useEffect, useState } from 'react'
import { CalendarOff, ChevronLeft, ChevronRight, Copy, Sparkles, Sun, Sunrise } from 'lucide-react'
import { sb, today, monday, addDays, hari, useRows, ok, toast, Err, Select, usePage, Pagination, type Ds, type Me, type Rider } from './lib'
import { buatDraf } from './otomatis'

const SIKLUS = ['', 'pagi', 'siang'] // urutan ganti saat sel diklik
const NAMA_HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const inisial = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

// Satu sel jadwal berbentuk pil: Pagi (kuning), Siang (ungu), kosong = libur (garis putus-putus). Dengan `klik` jadi tombol.
function Pil({ v, klik, title }: { v: string; klik?: () => void; title?: string }) {
  const gaya =
    v === 'pagi' ? 'border-warning/30 bg-warning-soft text-warning'
    : v === 'siang' ? 'border-primary/30 bg-primary-soft text-primary-soft-foreground'
    : 'border-dashed border-border text-muted-foreground/50'
  const isi = v === 'pagi' ? <><Sunrise size={13} />Pagi</> : v === 'siang' ? <><Sun size={13} />Siang</> : <span title="Libur">·</span>
  const kelas = `inline-flex w-[4.75rem] items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-all ${gaya}`
  return klik ? (
    <button type="button" title={title} onClick={klik} className={`${kelas} hover:scale-105 hover:border-primary ${v ? '' : 'hover:text-primary'}`}>{isi}</button>
  ) : (
    <span className={kelas}>{isi}</span>
  )
}

// Jumlah rider terisi dibanding kuota: hijau = pas, kuning = kurang, merah = kelebihan
function Kuota({ label, n, q }: { label: string; n: number; q: number }) {
  const warna = n === q ? 'text-success' : n < q ? 'text-warning' : 'text-danger'
  return (
    <div className={`flex items-center justify-between gap-2 font-mono text-[11px] font-semibold ${warna}`}>
      <span>{label}</span>
      <span>{n}/{q}</span>
    </div>
  )
}

// Grid jadwal 1 DS × 1 minggu (Senin–Minggu). editable = Captain; read-only = Super-admin.
export function JadwalGrid({ ds, editable }: { ds: Ds; editable: boolean }) {
  const [start, setStart] = useState(() => (editable ? addDays(monday(today()), 7) : monday(today())))
  const [q, setQ] = useState('')
  const [g, setG] = useState<Record<string, string>>({}) // "riderId|tanggal" -> shift
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const riders = useRows<Rider>(() => sb.from('riders').select('*').eq('ds_id', ds.id).eq('status', 'aktif').order('nama'), [ds.id])
  const j = useRows<{ rider_id: string; tanggal: string; shift: string }>(
    () => sb.from('jadwal').select('rider_id,tanggal,shift').eq('ds_id', ds.id).gte('tanggal', days[0]).lte('tanggal', days[6]),
    [ds.id, start],
  )
  useEffect(() => {
    setG(Object.fromEntries(j.rows.map((r) => [`${r.rider_id}|${r.tanggal}`, r.shift])))
  }, [j.rows])

  const cnt = (d: string, s: string) => riders.rows.filter((r) => g[`${r.id}|${d}`] === s).length
  const shown = riders.rows.filter((r) => (r.nama + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()))
  const pg = usePage(shown, [q, ds.id, start])

  const adaIsi = days.some((d) => riders.rows.some((r) => g[`${r.id}|${d}`]))

  // Draf otomatis: dibagi sesuai kuota DS secara adil. Belum tersimpan sampai Captain klik "Simpan jadwal".
  const susunOtomatis = () => {
    if (ds.kuota_pagi + ds.kuota_siang === 0) return toast('Kuota DS masih 0. Minta Super-admin mengisi kuota pagi dan siang di Kelola DS & Captain.')
    if (!riders.rows.length) return toast('Belum ada rider aktif di DS ini.')
    if (adaIsi && !confirm('Jadwal minggu ini sudah ada isinya. Ganti dengan draf otomatis?')) return
    const { grid, kurang } = buatDraf(riders.rows.map((r) => r.id), days, ds.kuota_pagi, ds.kuota_siang)
    setG(grid)
    toast.ok(`Draf jadwal dibuat (${Object.keys(grid).length} shift). Periksa dulu, lalu klik Simpan jadwal.`)
    if (kurang.length) toast(`Rider kurang untuk memenuhi kuota di ${kurang.length} hari (mulai ${hari(kurang[0].tanggal)}). Tambah rider atau kurangi kuota.`)
  }

  const salinMingguLalu = async () => {
    const { data, error } = await sb.from('jadwal').select('rider_id,tanggal,shift').eq('ds_id', ds.id).gte('tanggal', addDays(start, -7)).lte('tanggal', addDays(start, -1))
    if (error) return toast(error.message)
    const aktif = new Set(riders.rows.map((r) => r.id)) // rider yang sudah pindah/nonaktif tidak ikut disalin
    const baru: Record<string, string> = {}
    for (const r of data ?? []) if (aktif.has(r.rider_id)) baru[`${r.rider_id}|${addDays(r.tanggal, 7)}`] = r.shift
    if (!Object.keys(baru).length) return toast('Minggu lalu belum ada jadwal untuk disalin.')
    if (adaIsi && !confirm('Jadwal minggu ini sudah ada isinya. Ganti dengan salinan minggu lalu?')) return
    setG(baru)
    toast.ok('Jadwal minggu lalu disalin. Periksa dulu, lalu klik Simpan jadwal.')
  }

  const save = async () => {
    const rows = Object.entries(g)
      .filter(([k, s]) => s && s !== 'off' && days.includes(k.split('|')[1]))
      .map(([k, shift]) => {
        const [rider_id, tanggal] = k.split('|')
        return { rider_id, tanggal, shift }
      })
    if (await ok(sb.rpc('simpan_jadwal', { p_ds: ds.id, p_dari: days[0], p_sampai: days[6], p_rows: rows }))) {
      toast.ok('Jadwal berhasil disimpan')
      j.reload()
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-xl border border-border bg-card shadow-sm">
          <button className="rounded-l-xl p-2.5 transition-colors hover:bg-muted" onClick={() => setStart(addDays(start, -7))} aria-label="Minggu sebelumnya"><ChevronLeft size={18} /></button>
          <div className="min-w-48 px-2 text-center text-sm font-semibold">{hari(days[0])} – {hari(days[6])}</div>
          <button className="rounded-r-xl p-2.5 transition-colors hover:bg-muted" onClick={() => setStart(addDays(start, 7))} aria-label="Minggu berikutnya"><ChevronRight size={18} /></button>
        </div>
        <button className="btn2" disabled={start === monday(today())} onClick={() => setStart(monday(today()))}>Minggu ini</button>
        <input className="inp w-56" placeholder="Cari rider / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
          <Pil v="pagi" /> <Pil v="siang" /> <Pil v="" /> <span>libur</span>
        </div>
        {editable && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn2" onClick={salinMingguLalu}><Copy size={14} />Salin minggu lalu</button>
            <button className="btn2" onClick={susunOtomatis}><Sparkles size={14} />Susun otomatis</button>
            <button className="btn" onClick={save}>Simpan jadwal</button>
          </div>
        )}
      </div>
      <Err msg={riders.err || j.err} />
      {!editable && !j.rows.length && riders.rows.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          <CalendarOff size={20} className="shrink-0" />
          Belum ada jadwal di minggu ini. Captain DS ini belum menyusunnya.
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
                return (
                  <th key={d} className={`border-b border-border px-2 py-2 text-center ${hariIni ? 'bg-primary-soft' : 'bg-card'}`}>
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{NAMA_HARI[i]}</div>
                    <div className={`mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full text-sm font-bold ${hariIni ? 'bg-primary text-primary-foreground' : ''}`}>{d.slice(8)}</div>
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
                      <td key={d} className={`border-b border-border/60 px-2 py-2 text-center transition-colors group-hover:bg-primary-soft/60 ${d === today() ? 'bg-primary-soft/40' : ''}`}>
                        <Pil v={v} title="Klik untuk mengganti: libur → pagi → siang" klik={editable ? () => setG({ ...g, [k]: SIKLUS[(SIKLUS.indexOf(v) + 1) % SIKLUS.length] }) : undefined} />
                      </td>
                    )
                  })}
                  <td className="border-b border-border/60 px-3 py-2 text-center font-mono text-sm transition-colors group-hover:bg-primary-soft/60">
                    <span className={kerja > 6 ? 'font-bold text-danger' : 'font-semibold'}>{kerja}</span>
                    <span className="text-muted-foreground">/7</span>
                  </td>
                </tr>
              )
            })}
            {!pg.rows.length && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">{riders.rows.length ? 'Tidak ada rider yang cocok dengan pencarian.' : 'Belum ada rider aktif di DS ini.'}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 z-10 bg-muted px-4 py-3 text-xs font-semibold">Jumlah rider / kuota<div className="font-normal text-[11px] text-muted-foreground">P = pagi, S = siang</div></td>
              {days.map((d) => (
                <td key={d} className={`px-3 py-2.5 ${d === today() ? 'bg-primary-soft' : 'bg-muted'}`}>
                  <Kuota label="P" n={cnt(d, 'pagi')} q={ds.kuota_pagi} />
                  <Kuota label="S" n={cnt(d, 'siang')} q={ds.kuota_siang} />
                </td>
              ))}
              <td className="bg-muted" />
            </tr>
          </tfoot>
        </table>
        </div>
        <Pagination {...pg} />
      </div>
      {editable && <p className="text-xs text-muted-foreground mt-2">Warna kuning artinya jumlah rider belum sama dengan kuota. Jadwal tetap bisa disimpan. "Susun otomatis" membagi shift sesuai kuota secara adil (maksimal 6 hari kerja per rider, jadi ada minimal 1 hari libur). Hasilnya hanya draf: periksa dan ubah dulu, baru klik Simpan jadwal.</p>}
    </div>
  )
}

export function JadwalDs({ ds }: { me: Me; ds: Ds | null }) {
  return ds ? <JadwalGrid key={ds.id} ds={ds} editable /> : <p>Anda belum ditunjuk sebagai Captain di DS mana pun.</p>
}

// Super-admin: lihat jadwal semua DS (read-only — penyusunan sepenuhnya di Captain)
export function JadwalSemua({ daftar }: { daftar?: Ds[] }) {
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const rows = daftar ?? dsl.rows // Arcon: hanya DS yang dipegang; Super-admin: semua DS
  const [id, setId] = useState('')
  const ds = rows.find((d) => d.id === (id || rows[0]?.id))
  return (
    <div>
      <Select className="mb-3 w-72 max-w-full" value={ds?.id ?? ''} onChange={setId} placeholder="Pilih DS" opsi={rows.map((d) => ({ value: d.id, label: d.nama }))} />
      {ds ? <JadwalGrid key={ds.id} ds={ds} editable={false} /> : <p className="text-muted-foreground">Belum ada DS.</p>}
    </div>
  )
}
