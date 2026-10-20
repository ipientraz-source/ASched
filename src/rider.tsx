import { sb, today, hari, useRows, Err, type Me } from './lib'

const SHIFT: Record<string, string> = { pagi: 'Pagi', siang: 'Siang', off: 'Libur' }

function List({ rows }: { rows: { tanggal: string; shift: string; ds?: string | null }[] }) {
  if (!rows.length) return <p className="text-zinc-500">Belum ada jadwal ke depan.</p>
  return (
    <ul className="divide-y bg-white rounded border border-zinc-200">
      {rows.map((r) => (
        <li key={r.tanggal} className="flex justify-between px-3 py-2">
          <span>{hari(r.tanggal)}</span>
          <span className="font-medium">
            {SHIFT[r.shift] ?? r.shift}
            {r.ds ? ` · ${r.ds}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

// Rider: login Kode MTR, lihat jadwal sendiri (pasif)
export function RiderApp({ kode, out }: { kode: string; out: () => void }) {
  const { rows, err } = useRows<{ nama: string; ds_nama: string | null; tanggal: string | null; shift: string }>(
    () => sb.rpc('jadwal_rider', { p_kode: kode }),
    [kode],
  )
  return (
    <div className="max-w-md mx-auto p-4">
      <div className="flex justify-between items-center mb-3">
        <h1 className="font-semibold">{rows[0]?.nama ?? 'Jadwal Saya'}</h1>
        <button className="btn2" onClick={out}>
          Keluar
        </button>
      </div>
      <Err msg={err} />
      <List rows={rows.filter((r) => r.tanggal).map((r) => ({ tanggal: r.tanggal!, shift: r.shift, ds: r.ds_nama }))} />
    </div>
  )
}

// Topi rider untuk Captain / admin: jadwal dirinya sendiri
export function JadwalSaya({ me }: { me: Me }) {
  const { rows, err } = useRows<{ tanggal: string; shift: string; ds: { nama: string } | null }>(
    () => sb.from('jadwal').select('tanggal,shift,ds(nama)').eq('rider_id', me.id).gte('tanggal', today()).order('tanggal'),
    [me.id],
  )
  return (
    <>
      <Err msg={err} />
      <List rows={rows.map((r) => ({ tanggal: r.tanggal, shift: r.shift, ds: r.ds?.nama }))} />
    </>
  )
}
