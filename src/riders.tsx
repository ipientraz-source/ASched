import { useState } from 'react'
import { sb, useRows, ok, Err, Kosong, toCsv, download, parseCsv, type Ds, type Me, type Rider } from './lib'

type Hasil = { inserted: number; updated: number; errors: { baris: number; pesan: string }[] }

export function DataRider({ me, ds }: { me: Me; ds: Ds | null }) {
  const sup = me.peran === 'super_admin'
  const [q, setQ] = useState('')
  const [fds, setFds] = useState('')
  const rs = useRows<Rider>(() => sb.from('riders').select('*').order('nama').limit(1000), [])
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const dsNama = (id: string | null) => dsl.rows.find((d) => d.id === id)?.nama ?? '—'

  const orang = rs.rows.filter((r) => r.peran !== 'super_admin') // super-admin bukan rider — dikelola di Kelola DS & Captain
  const shown = orang.filter(
    (r) => (r.nama + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase()) && (!fds || (fds === '-' ? !r.ds_id : r.ds_id === fds)),
  )
  const aktif = orang.filter((r) => r.status === 'aktif').length

  const setStatus = async (r: Rider) => {
    if (await ok(sb.from('riders').update({ status: r.status === 'aktif' ? 'nonaktif' : 'aktif' }).eq('id', r.id))) rs.reload()
  }
  const setDs = async (r: Rider, ds_id: string) => {
    if (await ok(sb.from('riders').update({ ds_id: ds_id || null }).eq('id', r.id))) rs.reload()
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="stat"><b>{orang.length}</b><span>Total rider</span></div>
        <div className="stat"><b>{aktif}</b><span>Aktif</span></div>
        <div className="stat"><b>{orang.filter((r) => !r.ds_id && r.peran === 'rider').length}</b><span>Kolam bebas (belum punya DS)</span></div>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <input className="inp" placeholder="cari nama / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        {sup && (
          <select className="inp" value={fds} onChange={(e) => setFds(e.target.value)}>
            <option value="">Semua DS</option>
            <option value="-">Kolam bebas</option>
            {dsl.rows.map((d) => (
              <option key={d.id} value={d.id}>{d.nama}</option>
            ))}
          </select>
        )}
        {sup && (
          <button className="btn2 ml-auto" onClick={() => download('rider.csv', toCsv(shown.map((r) => ({ kode_mtr: r.kode_mtr, nama: r.nama, no_hp: r.no_hp, ds: dsNama(r.ds_id) === '—' ? '' : dsNama(r.ds_id), status: r.status, peran: r.peran }))))}>
            Ekspor CSV
          </button>
        )}
      </div>
      <Err msg={rs.err} />
      {!shown.length && (
        <div className="card">
          <Kosong teks={orang.length ? 'Tidak ada rider yang cocok' : 'Belum ada rider'} hint={orang.length ? 'Ubah kata kunci atau filter DS.' : 'Import CSV di bawah, atau tambah rider satuan.'} />
        </div>
      )}
      <div className="overflow-x-auto mb-4">
        <table className="tbl">
          <thead>
            <tr><th>Kode MTR</th><th>Nama</th><th>No HP</th><th>DS</th><th>Peran</th><th>Status</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{r.kode_mtr}</td><td>{r.nama}</td><td>{r.no_hp}</td>
                <td>
                  {sup ? (
                    <select className="inp" value={r.ds_id ?? ''} onChange={(e) => setDs(r, e.target.value)}>
                      <option value="">— kolam bebas —</option>
                      {dsl.rows.map((d) => (
                        <option key={d.id} value={d.id}>{d.nama}</option>
                      ))}
                    </select>
                  ) : (
                    dsNama(r.ds_id)
                  )}
                </td>
                <td>{r.peran}</td>
                <td>
                  <button className={r.status === 'aktif' ? 'btn2 text-green-700' : 'btn2 text-zinc-500'} disabled={!sup && r.ds_id !== ds?.id} onClick={() => setStatus(r)}>
                    {r.status}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sup ? <ImportCsv done={rs.reload} /> : ds && <Tarik ds={ds} done={rs.reload} />}
      {sup && <TambahRider dsl={dsl.rows} done={rs.reload} />}
    </div>
  )
}

function TambahRider({ dsl, done }: { dsl: Ds[]; done: () => void }) {
  const [f, setF] = useState({ kode_mtr: '', nama: '', no_hp: '', ds_id: '' })
  return (
    <div className="card">
      <b className="block mb-2">Tambah rider satuan</b>
      <div className="flex flex-wrap gap-2">
        <input className="inp" placeholder="Kode MTR" value={f.kode_mtr} onChange={(e) => setF({ ...f, kode_mtr: e.target.value })} />
        <input className="inp" placeholder="Nama" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        <input className="inp" placeholder="No HP" value={f.no_hp} onChange={(e) => setF({ ...f, no_hp: e.target.value })} />
        <select className="inp" value={f.ds_id} onChange={(e) => setF({ ...f, ds_id: e.target.value })}>
          <option value="">— kolam bebas —</option>
          {dsl.map((d) => (
            <option key={d.id} value={d.id}>{d.nama}</option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!f.kode_mtr.trim() || !f.nama.trim()}
          onClick={async () => {
            if (await ok(sb.from('riders').insert({ kode_mtr: f.kode_mtr, nama: f.nama.trim(), no_hp: f.no_hp || null, ds_id: f.ds_id || null }))) {
              setF({ kode_mtr: '', nama: '', no_hp: '', ds_id: '' })
              done()
            }
          }}
        >
          Tambah
        </button>
      </div>
    </div>
  )
}

// Import CSV (Super-admin): gabung pakai Kode MTR; DS harus sudah ada; yang tak ada di file dibiarkan
function ImportCsv({ done }: { done: () => void }) {
  const [hasil, setHasil] = useState<Hasil | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(f: File) {
    const [h, ...body] = parseCsv((await f.text()).replace(/^﻿/, ''))
    const idx = (n: string) => h.findIndex((x) => x.trim().toLowerCase() === n)
    const cols = { kode_mtr: idx('kode_mtr'), nama: idx('nama'), no_hp: idx('no_hp'), ds: idx('ds'), status: idx('status') }
    if (cols.kode_mtr < 0 || cols.nama < 0) return alert('Header wajib: kode_mtr, nama (opsional: no_hp, ds, status)')
    const rows = body
      .map((c, i) => ({
        baris: i + 2,
        ...Object.fromEntries(Object.entries(cols).map(([k, ci]) => [k, ci < 0 ? '' : (c[ci] ?? '').trim()])),
      }))
      .filter((r) => Object.values(r).some((v) => typeof v === 'string' && v !== ''))
    setBusy(true)
    const { data, error } = await sb.rpc('import_riders', { p_rows: rows })
    setBusy(false)
    if (error) return alert(error.message)
    setHasil(data as Hasil)
    done()
  }

  return (
    <div className="card">
      <b className="block mb-1">Import CSV rider</b>
      <p className="text-xs text-zinc-500 mb-2">
        Kolom: kode_mtr, nama, no_hp, ds, status. Nama DS harus persis sama dengan DS yang sudah dibuat. Rider yang sudah ada di-update, yang baru ditambah, yang tidak ada di file dibiarkan.{' '}
        <button className="underline" onClick={() => download('template-rider.csv', 'kode_mtr,nama,no_hp,ds,status\r\nMTR001,Budi,0812xxxx,Galaxy,aktif')}>
          Unduh template
        </button>
      </p>
      <input type="file" accept=".csv,text/csv" disabled={busy} className="text-sm text-zinc-500 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3.5 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-ink" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {hasil && (
        <div className="mt-2 text-sm">
          <p>
            Ditambah <b>{hasil.inserted}</b>, di-update <b>{hasil.updated}</b>, error <b className={hasil.errors.length ? 'text-red-600' : ''}>{hasil.errors.length}</b>
          </p>
          <ul className="text-red-600">
            {hasil.errors.map((e, i) => (
              <li key={i}>baris {e.baris}: {e.pesan}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Captain: cari rider di semua DS / kolam bebas, lalu tarik ke DS-nya
function Tarik({ ds, done }: { ds: Ds; done: () => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ id: string; nama: string; ds_id: string | null; ds_nama: string | null; status: string }[]>([])
  const cari = async () => {
    const { data, error } = await sb.rpc('cari_rider', { p_q: q.trim() })
    if (error) return alert(error.message)
    setRes(data ?? [])
  }
  return (
    <div className="card">
      <b className="block mb-2">Tarik rider ke {ds.nama}</b>
      <div className="flex gap-2 mb-2">
        <input className="inp" placeholder="cari nama / Kode MTR (semua DS)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim().length >= 2 && cari()} />
        <button className="btn" disabled={q.trim().length < 2} onClick={cari}>Cari</button>
      </div>
      <ul className="text-sm divide-y">
        {res.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-1">
            <span>{r.nama}</span>
            <span className="text-zinc-400">{r.ds_nama ?? 'kolam bebas'}</span>
            <button
              className="btn2 ml-auto"
              disabled={r.ds_id === ds.id}
              onClick={async () => {
                if (confirm(`Tarik ${r.nama} dari ${r.ds_nama ?? 'kolam bebas'} ke ${ds.nama}?`) && (await ok(sb.rpc('tarik_rider', { p_rider: r.id })))) {
                  setRes([])
                  done()
                }
              }}
            >
              {r.ds_id === ds.id ? 'Sudah di DS Anda' : 'Tarik'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
