import { useState } from 'react'
import { sb, today, monday, hari, useRows, ok, toast, Err, Kosong, RiderPick, Select, usePage, Pagination, type Ds, type Me, type Rider } from './lib'

type Act = { rider_id: string; status: string; backup_untuk_id: string | null; penjelasan: string | null }
type Catat = (rider: string, status: string, backup?: string, teks?: string) => Promise<boolean>

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

function DailyInner({ ds }: { ds: Ds }) {
  const [tgl, setTgl] = useState(today())
  const [q, setQ] = useState('')
  const riders = useRows<Rider>(() => sb.from('riders').select('*').eq('ds_id', ds.id).eq('status', 'aktif').order('nama'), [ds.id])
  const jd = useRows<{ rider_id: string; shift: string }>(() => sb.from('jadwal').select('rider_id,shift').eq('ds_id', ds.id).eq('tanggal', tgl), [ds.id, tgl])
  const ac = useRows<Act>(
    () => sb.from('actual_harian').select('rider_id,status,backup_untuk_id,penjelasan').eq('ds_id', ds.id).eq('tanggal', tgl),
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

  const listed = riders.rows.filter((r) => shift(r.id) || act(r.id))
  const shown = listed.filter((r) => (r.nama + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()))
  const terjadwal = riders.rows.filter((r) => shift(r.id))
  const terisi = terjadwal.filter((r) => act(r.id)).length
  const pg = usePage(shown, [q, tgl])

  const catat: Catat = async (rider, status, backup, teks) => {
    const done = await ok(
      sb.rpc('catat_actual', { p_tanggal: tgl, p_rider: rider, p_status: status, p_backup: backup || null, p_penjelasan: teks || null }),
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
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="w-28 h-2 rounded-full bg-border overflow-hidden">
            <span className="block h-full bg-primary" style={{ width: terjadwal.length ? `${(100 * terisi) / terjadwal.length}%` : '0%' }} />
          </span>
          <span className="font-mono">{terisi}/{terjadwal.length}</span> rider sudah diabsen
        </span>
        <input className="inp ml-auto" placeholder="cari rider / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {locked && <p className="bg-warning-soft border border-warning/40 rounded p-2 text-sm mb-3">Absensi minggu ini sudah dikunci dan tidak bisa diubah lagi.</p>}
      <Err msg={riders.err || jd.err || ac.err} />
      <div className="space-y-2">
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
        {!shown.length && <div className="card"><Kosong teks="Tidak ada rider yang dijadwalkan di tanggal ini" hint="Susun jadwal di tab Jadwal DS Saya, atau tambahkan rider pengganti di bawah." /></div>}
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
  const [buka, setBuka] = useState(false)
  const [alasan, setAlasan] = useState('alpha')
  const [backup, setBackup] = useState('')
  const [teks, setTeks] = useState('')

  const simpan = async () => {
    if (alasan === 'tukar' && !backup) return toast('Pilih rekan yang bertukar')
    if (await catat(r.id, alasan, alasan === 'alpha' || alasan === 'tukar' ? backup : undefined, teks)) setBuka(false)
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
        {act?.penjelasan && <span className="text-xs text-muted-foreground">“{act.penjelasan}”</span>}
        <div className="ml-auto flex gap-2">
          <button className="btn btn-lg" disabled={locked} onClick={() => catat(r.id, 'hadir')}>
            Hadir
          </button>
          <button className="btn2 btn-lg" disabled={locked} onClick={() => setBuka(!buka)}>
            Tidak hadir
          </button>
          {act && (
            <button className="btn2" disabled={locked} onClick={() => hapus(r.id)} title="Hapus isian, kembali ke belum diabsen">
              Batalkan
            </button>
          )}
        </div>
      </div>
      {buka && (
        <div className="mt-2 pt-2 border-t flex flex-wrap gap-2 items-center">
          <Select className="w-72 max-w-full" value={alasan} onChange={setAlasan} opsi={ALASAN.map(([value, label]) => ({ value, label }))} />
          {(alasan === 'alpha' || alasan === 'tukar') && (
            <RiderPick riders={rekan} value={backup} onChange={setBackup} placeholder={alasan === 'tukar' ? 'Rekan tukar' : 'Pengganti / backup (opsional)'} />
          )}
          {alasan !== 'tukar' && (
            <input className="inp flex-1 min-w-40" placeholder={alasan === 'sakit' ? 'Keterangan (opsional)' : 'Keterangan'} value={teks} onChange={(e) => setTeks(e.target.value)} />
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
  return (
    <div className="card mt-4">
      <b className="block mb-2">Tambah rider pengganti</b>
      <p className="text-xs text-muted-foreground mb-3 -mt-1">Untuk rider yang masuk kerja padahal tidak ada di jadwal hari itu.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <RiderPick riders={kandidat} value={rid} onChange={setRid} placeholder="Rider pengganti" />
        <RiderPick riders={terjadwal} value={gt} onChange={setGt} placeholder="Menggantikan siapa? (opsional)" />
        <button
          className="btn"
          disabled={!rid || locked}
          onClick={async () => {
            if (await catat(rid, 'pengganti', gt)) {
              setRid('')
              setGt('')
            }
          }}
        >
          Tambah
        </button>
      </div>
    </div>
  )
}
