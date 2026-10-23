import { useEffect, useState } from 'react'
import { sb, today, monday, hari, useRows, ok, toast, Err, Kosong, RiderPick, Select, usePage, Pagination, type Ds, type Me, type Rider } from './lib'

type Act = { rider_id: string; status: string; backup_untuk_id: string | null; penjelasan: string | null; potongan: boolean | null; insentif: number }
// potongan: Ya/Tidak untuk alpha/izin/sakit; insentif: nominal rupiah untuk rider pengganti
type TabShift = 'pagi' | 'siang' | 'lain'
type Catat = (rider: string, status: string, backup?: string, teks?: string, potongan?: boolean | null, insentif?: number) => Promise<boolean>

const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`
const angka = (s: string) => parseInt(s.replace(/\D/g, ''), 10) || 0

// Dua pilihan berdampingan (mis. Ya / Tidak); opsi ketiga true = pilihan netral (warna gelap)
function Pilih({ nilai, ubah, opsi }: { nilai: string; ubah: (v: string) => void; opsi: [string, string, boolean?][] }) {
  return (
    <span role="group" className="inline-flex overflow-hidden rounded-lg border border-input">
      {opsi.map(([v, label, netral]) => (
        <button
          key={v}
          type="button"
          aria-pressed={nilai === v}
          onClick={() => ubah(v)}
          className={`px-3.5 py-1.5 text-sm font-semibold transition-colors ${nilai === v ? (netral ? 'bg-foreground text-background' : 'bg-primary text-primary-foreground') : 'bg-card text-muted-foreground hover:bg-muted'}`}
        >
          {label}
        </button>
      ))}
    </span>
  )
}

function Nominal({ nilai, ubah }: { nilai: string; ubah: (v: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      Rp
      <input className="inp w-40" inputMode="numeric" placeholder="Nominal, mis. 50000" value={nilai} onChange={(e) => ubah(e.target.value.replace(/\D/g, '').slice(0, 9))} />
    </span>
  )
}

const ALASAN: [string, string][] = [
  ['alpha', 'Tidak hadir tanpa kabar (Alpha)'],
  ['izin', 'Izin'],
  ['sakit', 'Sakit'],
  ['tukar', 'Tukar shift (sudah direncanakan)'],
]
export const WARNA: Record<string, string> = {
  hadir: 'bg-foreground text-background',
  alpha: 'bg-danger-soft text-danger',
  izin: 'bg-border text-foreground/80',
  sakit: 'bg-border text-foreground/80',
  tukar: 'bg-primary-soft text-primary-soft-foreground',
  pengganti: 'bg-primary text-white',
}

export function Daily({ ds }: { me: Me; ds: Ds | null }) {
  return ds ? <DailyInner ds={ds} /> : <p>Anda belum ditunjuk sebagai Captain di DS mana pun.</p>
}

// Super-admin (akses penuh): isi atau koreksi absensi di DS mana pun
export function AbsensiSemua() {
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const [id, setId] = useState('')
  const ds = dsl.rows.find((d) => d.id === (id || dsl.rows[0]?.id))
  return (
    <div>
      <Select className="mb-3 w-72 max-w-full" value={ds?.id ?? ''} onChange={setId} placeholder="Pilih DS" opsi={dsl.rows.map((d) => ({ value: d.id, label: d.nama }))} />
      {ds ? <DailyInner key={ds.id} ds={ds} /> : <p className="text-muted-foreground">Belum ada DS.</p>}
    </div>
  )
}

function DailyInner({ ds }: { ds: Ds }) {
  const [tgl, setTgl] = useState(today())
  const [q, setQ] = useState('')
  const riders = useRows<Rider>(() => sb.from('riders').select('*').eq('ds_id', ds.id).eq('status', 'aktif').order('nama'), [ds.id])
  const jd = useRows<{ rider_id: string; shift: string }>(() => sb.from('jadwal').select('rider_id,shift').eq('ds_id', ds.id).eq('tanggal', tgl), [ds.id, tgl])
  const ac = useRows<Act>(
    () => sb.from('actual_harian').select('rider_id,status,backup_untuk_id,penjelasan,potongan,insentif').eq('ds_id', ds.id).eq('tanggal', tgl),
    [ds.id, tgl],
  )
  const lock = useRows<{ minggu_mulai: string }>(
    () => sb.from('periode_kunci').select('minggu_mulai').eq('ds_id', ds.id).eq('minggu_mulai', monday(tgl)),
    [ds.id, tgl],
  )
  const locked = lock.rows.length > 0
  const nama = (id: string | null) => riders.rows.find((r) => r.id === id)?.nama ?? '?'
  const shift = (id: string) => jd.rows.find((r) => r.rider_id === id && r.shift !== 'off')?.shift
  const act = (id: string) => ac.rows.find((r) => r.rider_id === id)

  // Tiap rider masuk tab shift-nya. Rider pengganti (tak ada di jadwal hari itu) ikut tab shift rider yang digantikannya;
  // kalau tidak menggantikan siapa pun, masuk tab "Lainnya".
  const shiftTab = (id: string): TabShift => {
    const s = shift(id) ?? shift(act(id)?.backup_untuk_id ?? '')
    return s === 'pagi' || s === 'siang' ? s : 'lain'
  }
  const listed = riders.rows.filter((r) => shift(r.id) || act(r.id))
  const terjadwal = riders.rows.filter((r) => shift(r.id))
  const hitung = (t: TabShift) => ({ total: terjadwal.filter((r) => shiftTab(r.id) === t).length, terisi: terjadwal.filter((r) => shiftTab(r.id) === t && act(r.id)).length })
  const ada = (t: TabShift) => listed.some((r) => shiftTab(r.id) === t)
  // Tab awal: shift pertama yang masih ada rider belum diabsen (pagi dulu), jadi Captain langsung di shift yang perlu dilaporkan.
  const [pilihTab, setPilihTab] = useState<TabShift | null>(null)
  useEffect(() => setPilihTab(null), [tgl])
  const tabAwal: TabShift = (['pagi', 'siang'] as const).find((t) => hitung(t).terisi < hitung(t).total) ?? (ada('pagi') ? 'pagi' : ada('siang') ? 'siang' : 'pagi')
  const tab = pilihTab ?? tabAwal
  const dicari = q.trim().length > 0
  // Mencari rider menelusuri semua shift sekaligus; tanpa kata kunci, hanya shift yang sedang dibuka
  const shown = listed.filter((r) => (dicari || shiftTab(r.id) === tab) && (r.nama + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()))
  const total = hitung(tab).total
  const terisiTab = hitung(tab).terisi
  const pg = usePage(shown, [q, tgl, tab])

  const catat: Catat = async (rider, status, backup, teks, potongan, insentif) => {
    const done = await ok(
      sb.rpc('catat_actual', { p_tanggal: tgl, p_rider: rider, p_status: status, p_backup: backup || null, p_penjelasan: teks || null, p_potongan: potongan ?? null, p_insentif: insentif ?? 0 }),
    )
    if (done) ac.reload()
    return done
  }
  const hapus = async (rider: string) => {
    if (await ok(sb.rpc('hapus_actual', { p_tanggal: tgl, p_rider: rider }))) ac.reload()
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <input type="date" className="inp" value={tgl} max={today()} onChange={(e) => e.target.value && setTgl(e.target.value)} />
        <b>{hari(tgl)}</b>
        <input className="inp ml-auto" placeholder="cari rider / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div role="tablist" aria-label="Shift" className="mb-3 flex flex-wrap items-center gap-2">
        {([['pagi', 'Shift Pagi'], ['siang', 'Shift Siang'], ['lain', 'Lainnya']] as const).filter(([t]) => t !== 'lain' || ada('lain')).map(([t, label]) => {
          const h = hitung(t)
          const lengkap = h.total > 0 && h.terisi === h.total
          return (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setPilihTab(t)} className={`tab !px-3 ${tab === t && !dicari ? 'tab-on' : 'border border-border'}`}>
              {label}
              {h.total > 0 && <span className={`ml-2 font-mono text-xs ${tab === t && !dicari ? 'text-primary-foreground/80' : lengkap ? 'text-success' : 'text-muted-foreground'}`}>{h.terisi}/{h.total}{lengkap ? ' ✓' : ''}</span>}
            </button>
          )
        })}
        {!dicari && total > 0 && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-2 w-28 overflow-hidden rounded-full bg-border">
              <span className="block h-full bg-primary" style={{ width: `${(100 * terisiTab) / total}%` }} />
            </span>
            {terisiTab}/{total} rider sudah diabsen
          </span>
        )}
        {dicari && <span className="text-sm text-muted-foreground">Hasil pencarian dari semua shift</span>}
      </div>
      {locked && <p className="bg-warning-soft border border-warning/40 rounded p-2 text-sm mb-3">Absensi minggu ini sudah dikunci dan tidak bisa diubah lagi.</p>}
      <Err msg={riders.err || jd.err || ac.err} />
      <div className="space-y-3 md:space-y-2">
        {pg.rows.map((r) => (
          <Baris
            key={r.id + tgl}
            r={r}
            shift={shift(r.id)}
            act={act(r.id)}
            nama={nama}
            rekan={riders.rows.filter((x) => x.id !== r.id)}
            locked={locked}
            catat={catat}
            hapus={hapus}
          />
        ))}
        {!shown.length && <div className="card"><Kosong teks={dicari ? 'Tidak ada rider yang cocok' : listed.length ? `Tidak ada rider di ${tab === 'pagi' ? 'shift pagi' : tab === 'siang' ? 'shift siang' : 'tab ini'}` : 'Tidak ada rider yang dijadwalkan di tanggal ini'} hint={listed.length ? 'Coba shift lain di atas.' : 'Susun jadwal di tab Jadwal DS, atau tambahkan rider pengganti di bawah.'} /></div>}
      </div>
      <div className="mt-3"><Pagination {...pg} /></div>
      <TambahPengganti
        kandidat={riders.rows.filter((r) => !listed.some((l) => l.id === r.id))}
        terjadwal={terjadwal}
        locked={locked}
        catat={catat}
      />
    </div>
  )
}

function Baris({
  r, shift, act, nama, rekan, locked, catat, hapus,
}: {
  r: Rider
  shift?: string
  act?: Act
  nama: (id: string | null) => string
  rekan: Rider[]
  locked: boolean
  catat: Catat
  hapus: (id: string) => void
}) {
  // Form "Tidak hadir" memuat isian yang sudah tersimpan, jadi mengoreksi tidak mengulang dari awal.
  const lama = act && ['alpha', 'izin', 'sakit', 'tukar'].includes(act.status) ? act : undefined
  const [buka, setBuka] = useState(false)
  const [alasan, setAlasan] = useState(lama?.status ?? 'alpha')
  const [backup, setBackup] = useState(lama?.backup_untuk_id ?? '')
  const [teks, setTeks] = useState(lama?.penjelasan ?? '')
  const [potongan, setPotongan] = useState(lama ? (lama.potongan === true || (lama.potongan == null && lama.status === 'alpha') ? 'ya' : 'tidak') : 'ya') // saran awal: Alpha = Ya, Izin/Sakit = Tidak; Captain bisa mengubah
  const [ins, setIns] = useState(!!lama?.insentif)
  const [nominal, setNominal] = useState(lama?.insentif ? String(lama.insentif) : '')

  const gantiAlasan = (v: string) => {
    setAlasan(v)
    setPotongan(v === 'alpha' ? 'ya' : 'tidak')
    if (v !== 'alpha') {
      setIns(false)
      setNominal('')
    }
  }
  const simpan = async () => {
    if (alasan === 'tukar' && !backup) return toast('Pilih rekan yang bertukar')
    const adaIns = alasan === 'alpha' && !!backup && ins
    if (adaIns && angka(nominal) <= 0) return toast('Isi nominal insentif lebih dari 0')
    const pot = alasan === 'tukar' ? undefined : potongan === 'ya'
    if (await catat(r.id, alasan, alasan === 'alpha' || alasan === 'tukar' ? backup : undefined, teks, pot, adaIns ? angka(nominal) : 0)) setBuka(false)
  }

  return (
    <div className="card !mb-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40">
          <b>{r.nama}</b> <span className="text-muted-foreground/70 text-xs">{r.kode_mtr}</span>
          <div className="text-xs text-muted-foreground capitalize">{shift ?? 'tidak ada di jadwal'}</div>
        </div>
        {act && (
          <span className={`badge ${WARNA[act.status]}`}>
            {act.status}
            {act.status === 'pengganti' && act.backup_untuk_id ? ` untuk ${nama(act.backup_untuk_id)}` : ''}
          </span>
        )}
        {act?.potongan === true && <span className="badge bg-danger-soft text-danger">Potongan: Ya</span>}
        {act?.potongan === false && <span className="badge bg-muted text-muted-foreground">Tanpa potongan</span>}
        {!!act?.insentif && <span className="badge bg-success-soft text-success">+ Insentif {rupiah(act.insentif)}</span>}
        {act?.penjelasan && <span className="text-xs text-muted-foreground">“{act.penjelasan}”</span>}
        <div className="flex w-full flex-wrap gap-2 md:ml-auto md:w-auto">
          <button className="btn btn-lg flex-1 whitespace-nowrap md:flex-none" disabled={locked} onClick={() => { setBuka(false); catat(r.id, 'hadir') }}>
            Hadir
          </button>
          <button className="btn2 btn-lg flex-1 whitespace-nowrap md:flex-none" disabled={locked} aria-expanded={buka} onClick={() => setBuka(!buka)}>
            Tidak hadir
          </button>
          {act && (
            <button className="btn2 w-full md:w-auto" disabled={locked} onClick={() => hapus(r.id)} title="Hapus isian, kembali ke belum diabsen">
              Batalkan
            </button>
          )}
        </div>
      </div>
      {buka && (
        <div className="mt-2 pt-2 border-t flex flex-wrap gap-2 items-center">
          <Select className="w-72 max-w-full" value={alasan} onChange={gantiAlasan} opsi={ALASAN.map(([value, label]) => ({ value, label }))} />
          {(alasan === 'alpha' || alasan === 'tukar') && (
            <RiderPick riders={rekan} value={backup} onChange={setBackup} placeholder={alasan === 'tukar' ? 'Rekan tukar' : 'Pengganti / backup (opsional)'} />
          )}
          {alasan !== 'tukar' && (
            <input className="inp flex-1 min-w-40" placeholder={alasan === 'sakit' ? 'Keterangan (opsional)' : 'Keterangan'} value={teks} onChange={(e) => setTeks(e.target.value)} />
          )}
          {alasan !== 'tukar' && (
            <div className="flex basis-full flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Kena potongan gaji (deduction)?</span>
              <Pilih nilai={potongan} ubah={setPotongan} opsi={[['ya', 'Ya'], ['tidak', 'Tidak', true]]} />
              <span className="text-xs text-muted-foreground">Saran: {alasan === 'alpha' ? 'Ya' : 'Tidak'} untuk {alasan === 'alpha' ? 'tidak hadir tanpa kabar' : alasan}. Bisa diubah.</span>
            </div>
          )}
          {alasan === 'alpha' && backup && (
            <div className="flex basis-full flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Insentif untuk pengganti?</span>
              <Pilih nilai={ins ? 'ya' : 'tidak'} ubah={(v) => { setIns(v === 'ya'); if (v !== 'ya') setNominal('') }} opsi={[['tidak', 'Tanpa insentif', true], ['ya', '+ Insentif']]} />
              {ins && <Nominal nilai={nominal} ubah={setNominal} />}
            </div>
          )}
          <button className="btn" onClick={simpan}>
            Simpan
          </button>
        </div>
      )}
    </div>
  )
}

function TambahPengganti({ kandidat, terjadwal, locked, catat }: { kandidat: Rider[]; terjadwal: Rider[]; locked: boolean; catat: Catat }) {
  const [rid, setRid] = useState('')
  const [gt, setGt] = useState('')
  const [ins, setIns] = useState(false)
  const [nominal, setNominal] = useState('')
  return (
    <div className="card mt-4">
      <b className="block mb-2">Tambah rider pengganti</b>
      <p className="text-xs text-muted-foreground mb-3 -mt-1">Untuk rider yang masuk kerja padahal tidak ada di jadwal hari itu.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <RiderPick riders={kandidat} value={rid} onChange={setRid} placeholder="Rider pengganti" />
        <RiderPick riders={terjadwal} value={gt} onChange={setGt} placeholder="Menggantikan siapa? (opsional)" />
        <div className="flex basis-full flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Insentif untuk pengganti?</span>
          <Pilih nilai={ins ? 'ya' : 'tidak'} ubah={(v) => { setIns(v === 'ya'); if (v !== 'ya') setNominal('') }} opsi={[['tidak', 'Tanpa insentif', true], ['ya', '+ Insentif']]} />
          {ins && <Nominal nilai={nominal} ubah={setNominal} />}
        </div>
        <button
          className="btn"
          disabled={!rid || locked}
          onClick={async () => {
            if (ins && angka(nominal) <= 0) return toast('Isi nominal insentif lebih dari 0')
            if (await catat(rid, 'pengganti', gt, undefined, null, ins ? angka(nominal) : 0)) {
              setRid('')
              setGt('')
              setIns(false)
              setNominal('')
            }
          }}
        >
          Tambah
        </button>
      </div>
    </div>
  )
}
