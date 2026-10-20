// Pengguna: semua orang di sistem dikelompokkan menurut peran (Super-admin, Arcon, Captain, Rider). Hanya Super-admin.
import { useState } from 'react'
import { Network, ShieldCheck, UserCog, Users } from 'lucide-react'
import { sb, useRows, ok, toast, konfirmasi, Err, Kosong, Stat, usePage, Pagination, type Ds, type Peran, type Rider } from './lib'

const PERAN: Record<Peran, { label: string; gaya: string; ket: string }> = {
  super_admin: { label: 'Super-admin', gaya: 'bg-primary text-primary-foreground', ket: 'Akses penuh ke semua DS' },
  arcon: { label: 'Arcon', gaya: 'bg-primary-soft text-primary-soft-foreground', ket: 'Memantau beberapa DS (hanya lihat)' },
  captain: { label: 'Captain', gaya: 'bg-warning-soft text-warning', ket: 'Mengelola satu DS' },
  rider: { label: 'Rider', gaya: 'bg-muted text-foreground/80', ket: 'Masuk dengan Kode MTR' },
}
const URUT: Peran[] = ['super_admin', 'arcon', 'captain', 'rider']

export function Pengguna() {
  const rs = useRows<Rider>(() => sb.from('riders').select('*').order('nama').limit(1000), [])
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const [f, setF] = useState<'semua' | Peran>('semua')
  const [q, setQ] = useState('')
  const jml = (p: Peran) => rs.rows.filter((r) => r.peran === p).length
  const dsNama = (id: string | null) => dsl.rows.find((d) => d.id === id)?.nama
  // DS yang dipegang: Arcon dan Captain menurut penunjukan di tabel DS; rider menurut DS tempatnya bekerja
  const dipegang = (r: Rider): string[] =>
    r.peran === 'arcon' ? dsl.rows.filter((d) => d.arcon_id === r.id).map((d) => d.nama)
    : r.peran === 'captain' ? dsl.rows.filter((d) => d.captain_id === r.id).map((d) => d.nama)
    : r.peran === 'rider' && dsNama(r.ds_id) ? [dsNama(r.ds_id)!]
    : []
  const tampil = rs.rows
    .filter((r) => f === 'semua' || r.peran === f)
    .filter((r) => `${r.nama} ${r.email ?? ''} ${r.kode_mtr ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => URUT.indexOf(a.peran) - URUT.indexOf(b.peran) || a.nama.localeCompare(b.nama))
  const pg = usePage(tampil, [f, q])

  const ubahStatus = async (r: Rider) => {
    const ke = r.status === 'aktif' ? 'nonaktif' : 'aktif'
    const nonaktif = ke === 'nonaktif'
    const yakin = await konfirmasi(
      nonaktif ? `${r.nama} (${PERAN[r.peran].label}) tidak akan dihitung sebagai anggota aktif. Data dan riwayatnya tetap tersimpan.` : `${r.nama} akan aktif kembali.`,
      { judul: nonaktif ? `Nonaktifkan ${r.nama}?` : `Aktifkan ${r.nama}?`, ya: nonaktif ? 'Nonaktifkan' : 'Aktifkan', bahaya: nonaktif },
    )
    if (yakin && (await ok(sb.from('riders').update({ status: ke }).eq('id', r.id)))) {
      toast.ok(`${r.nama} sekarang ${ke}.`)
      rs.reload()
    }
  }

  return (
    <div>
      <Err msg={rs.err || dsl.err} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={ShieldCheck} label="Super-admin" value={jml('super_admin')} />
        <Stat icon={Network} label="Arcon" value={jml('arcon')} />
        <Stat icon={UserCog} label="Captain" value={jml('captain')} />
        <Stat icon={Users} label="Rider" value={jml('rider')} tone="zinc" />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="flex flex-wrap gap-1.5">
            {(['semua', ...URUT] as const).map((p) => (
              <button key={p} type="button" className={`tab ${f === p ? 'tab-on' : ''}`} onClick={() => setF(p)}>
                {p === 'semua' ? 'Semua' : PERAN[p].label} <span className="opacity-70">{p === 'semua' ? rs.rows.length : jml(p)}</span>
              </button>
            ))}
          </div>
          <input className="inp ml-auto w-64 max-w-full" placeholder="Cari nama, email, atau Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Nama</th><th>Peran</th><th>Email</th><th>DS yang dipegang</th><th>Status</th></tr>
            </thead>
            <tbody>
              {pg.rows.map((r) => {
                const ds = dipegang(r)
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium">{r.nama}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{r.kode_mtr ?? '—'}</div>
                    </td>
                    <td><span className={`badge ${PERAN[r.peran].gaya}`} title={PERAN[r.peran].ket}>{PERAN[r.peran].label}</span></td>
                    <td className="text-muted-foreground">{r.email ?? '—'}</td>
                    <td>
                      {r.peran === 'super_admin' ? <span className="text-muted-foreground">Semua DS</span>
                        : ds.length ? <div className="flex flex-wrap gap-1">{ds.map((n) => <span key={n} className="badge bg-muted text-foreground/80">{n}</span>)}</div>
                        : <span className="text-muted-foreground">Belum memegang DS</span>}
                    </td>
                    <td>
                      <button
                        className={r.status === 'aktif' ? 'btn2 capitalize text-success' : 'btn2 capitalize text-muted-foreground'}
                        disabled={r.peran === 'super_admin'}
                        title={r.peran === 'super_admin' ? 'Super-admin tidak dinonaktifkan dari sini, supaya akses penuh tidak hilang tanpa sengaja' : 'Klik untuk mengubah status'}
                        onClick={() => ubahStatus(r)}
                      >
                        {r.status}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!tampil.length && <Kosong teks={rs.rows.length ? 'Tidak ada pengguna yang cocok.' : 'Belum ada pengguna.'} />}
        <div className="p-4"><Pagination {...pg} /></div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Hanya Super-admin yang bisa mengubah status Arcon dan Captain. Untuk menunjuk atau mengganti Captain dan Arcon, pakai halaman Kelola DS &amp; Captain.
      </p>
    </div>
  )
}
