import { useEffect, useState } from 'react'
import { Copy, Sparkles } from 'lucide-react'
import { sb, today, monday, addDays, hari, useRows, ok, toast, Err, type Ds, type Me, type Rider } from './lib'
import { buatDraf } from './otomatis'

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
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <button className="btn2" onClick={() => setStart(addDays(start, -7))}>←</button>
        <b>
          {hari(days[0])} – {hari(days[6])}
        </b>
        <button className="btn2" onClick={() => setStart(addDays(start, 7))}>→</button>
        <input className="inp" placeholder="cari rider / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        {editable && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn2" onClick={salinMingguLalu}><Copy size={14} />Salin minggu lalu</button>
            <button className="btn2" onClick={susunOtomatis}><Sparkles size={14} />Susun otomatis</button>
            <button className="btn" onClick={save}>Simpan jadwal</button>
          </div>
        )}
      </div>
      <Err msg={riders.err || j.err} />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="tbl">
          <thead>
            <tr>
              <th>Rider</th>
              {days.map((d) => (
                <th key={d}>{hari(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">
                  {r.nama} <span className="text-muted-foreground/70">{r.kode_mtr}</span>
                </td>
                {days.map((d) => {
                  const k = `${r.id}|${d}`
                  const v = g[k] ?? ''
                  return (
                    <td key={d}>
                      {editable ? (
                        <select className="inp" value={v} onChange={(e) => setG({ ...g, [k]: e.target.value })}>
                          <option value="">—</option>
                          <option value="pagi">Pagi</option>
                          <option value="siang">Siang</option>
                        </select>
                      ) : (
                        v && <span className="capitalize">{v}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="bg-muted/50 font-medium">
              <td>Jumlah rider / kuota</td>
              {days.map((d) => {
                const p = cnt(d, 'pagi')
                const s = cnt(d, 'siang')
                return (
                  <td key={d} className="whitespace-nowrap">
                    <span className={p !== ds.kuota_pagi ? 'text-warning' : 'text-success'}>P {p}/{ds.kuota_pagi}</span>
                    {' · '}
                    <span className={s !== ds.kuota_siang ? 'text-warning' : 'text-success'}>S {s}/{ds.kuota_siang}</span>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
      {editable && <p className="text-xs text-muted-foreground mt-2">Warna kuning artinya jumlah rider belum sama dengan kuota. Jadwal tetap bisa disimpan. "Susun otomatis" membagi shift sesuai kuota secara adil (maksimal 6 hari kerja per rider, jadi ada minimal 1 hari libur). Hasilnya hanya draf: periksa dan ubah dulu, baru klik Simpan jadwal.</p>}
    </div>
  )
}

export function JadwalDs({ ds }: { me: Me; ds: Ds | null }) {
  return ds ? <JadwalGrid key={ds.id} ds={ds} editable /> : <p>Anda belum ditunjuk sebagai Captain di DS mana pun.</p>
}

// Super-admin: lihat jadwal semua DS (read-only — penyusunan sepenuhnya di Captain)
export function JadwalSemua() {
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const [id, setId] = useState('')
  const ds = dsl.rows.find((d) => d.id === (id || dsl.rows[0]?.id))
  return (
    <div>
      <select className="inp mb-3" value={ds?.id ?? ''} onChange={(e) => setId(e.target.value)}>
        {dsl.rows.map((d) => (
          <option key={d.id} value={d.id}>
            {d.nama}
          </option>
        ))}
      </select>
      {ds ? <JadwalGrid key={ds.id} ds={ds} editable={false} /> : <p className="text-muted-foreground">Belum ada DS.</p>}
    </div>
  )
}
