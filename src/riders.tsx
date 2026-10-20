import { useState } from 'react'
import { UserCheck, UserMinus, Users } from 'lucide-react'
import { sb, useRows, ok, toast, Err, Kosong, Stat, toCsv, download, parseCsv, type Ds, type Me, type Rider } from './lib'

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
        <Stat icon={Users} label="Total rider" value={orang.length} />
        <Stat icon={UserCheck} label="Rider aktif" value={aktif} tone="zinc" />
        <Stat icon={UserMinus} label="Belum punya DS" value={orang.filter((r) => !r.ds_id && r.peran === 'rider').length} tone="zinc" />
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <input className="inp" placeholder="cari nama / Kode MTR" value={q} onChange={(e) => setQ(e.target.value)} />
        {sup && (
          <select className="inp" value={fds} onChange={(e) => setFds(e.target.value)}>
            <option value="">Semua DS</option>
            <option value="-">Belum punya DS</option>
            {dsl.rows.map((d) => (
              <option key={d.id} value={d.id}>{d.nama}</option>
            ))}
          </select>
        )}
        {sup && (
          <button className="btn2 ml-auto" onClick={() => download('rider.csv', toCsv(shown.map((r) => ({ kode_mtr: r.kode_mtr, nama: r.nama, no_hp: r.no_hp, ds: dsNama(r.ds_id) === '—' ? '' : dsNama(r.ds_id), status: r.status, peran: r.peran }))))}>
            Unduh CSV
          </button>
        )}
      </div>
      <Err msg={rs.err} />
      {!shown.length && (
        <div className="card">
          <Kosong teks={orang.length ? 'Tidak ada rider yang cocok' : 'Belum ada rider'} hint={orang.length ? 'Ubah kata kunci atau filter DS.' : 'Import CSV di bawah, atau tambah rider satuan.'} />
        </div>
      )}
      <div className="overflow-x-auto mb-4 rounded-2xl border border-border bg-card shadow-sm">
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
                      <option value="">— belum punya DS —</option>
                      {dsl.rows.map((d) => (
                        <option key={d.id} value={d.id}>{d.nama}</option>
                      ))}
                    </select>
                  ) : (
                    dsNama(r.ds_id)
                  )}
                </td>
                <td><span className="badge bg-muted text-foreground/80 capitalize">{r.peran.replace('_', '-')}</span></td>
                <td>
                  <button className={r.status === 'aktif' ? 'btn2 capitalize text-success' : 'btn2 capitalize text-muted-foreground'} disabled={!sup && r.ds_id !== ds?.id} onClick={() => setStatus(r)}>
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
      <b className="block mb-2">Tambah satu rider</b>
      <div className="flex flex-wrap gap-2">
        <input className="inp" placeholder="Kode MTR" value={f.kode_mtr} onChange={(e) => setF({ ...f, kode_mtr: e.target.value })} />
        <input className="inp" placeholder="Nama" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        <input className="inp" placeholder="No HP" value={f.no_hp} onChange={(e) => setF({ ...f, no_hp: e.target.value })} />
        <select className="inp" value={f.ds_id} onChange={(e) => setF({ ...f, ds_id: e.target.value })}>
          <option value="">— belum punya DS —</option>
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

// Import CSV (Super-admin): gabung pakai Kode MTR; DS harus sudah ada; yang tak ada di file dibiarkan.
// Alur dua langkah ala Pulse: upload → preview → konfirmasi.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const ALIAS: Record<string, string[]> = {
  kode_mtr: ['kodemtr', 'employeeid', 'employee', 'id', 'mtr', 'kodemitra', 'mtrcode', 'idkaryawan', 'kodekaryawan'],
  nama: ['nama', 'fullname', 'name', 'namalengkap'],
  no_hp: ['nohp', 'phone', 'telepon', 'telp', 'hp', 'notelp', 'nowa', 'whatsapp', 'wa', 'nomorwhatsapp'],
  ds: ['ds', 'depot', 'store', 'namads'],
  status: ['status'],
}
// Alias status ala Pulse → aktif / nonaktif. Nilai lain dibiarkan apa adanya agar ditolak server dengan pesan jelas.
const STATUS: Record<string, string> = {
  aktif: 'aktif', active: 'aktif', ready: 'aktif', readytowork: 'aktif', available: 'aktif', hire: 'aktif', probation: 'aktif', contract: 'aktif',
  nonaktif: 'nonaktif', inactive: 'nonaktif', nonactive: 'nonaktif', resign: 'nonaktif', resigned: 'nonaktif', withdrawn: 'nonaktif', blacklisted: 'nonaktif', blacklist: 'nonaktif', suspended: 'nonaktif',
}
type Baris = { baris: number; kode_mtr: string; nama: string; no_hp: string; ds: string; status: string }

function ImportCsv({ done }: { done: () => void }) {
  const [rows, setRows] = useState<Baris[]>([])
  const [file, setFile] = useState('')
  const [hasil, setHasil] = useState<Hasil | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(f: File) {
    setHasil(null)
    const [h, ...body] = parseCsv((await f.text()).replace(/^﻿/, ''))
    if (!h || !body.length) return toast('CSV kosong atau hanya berisi header')
    const col: Record<string, number> = {}
    h.forEach((x, i) => {
      for (const [field, al] of Object.entries(ALIAS)) if (!(field in col) && (norm(x) === norm(field) || al.includes(norm(x)))) col[field] = i
    })
    if (!('kode_mtr' in col) || !('nama' in col)) return toast('Kolom wajib tidak ditemukan: kode_mtr (atau employee_id / kode mitra) dan nama (atau full_name)')
    const get = (c: string[], k: string) => (k in col ? (c[col[k]] ?? '').trim() : '')
    setRows(
      body
        .map((c, i) => {
          const st = get(c, 'status')
          return { baris: i + 2, kode_mtr: get(c, 'kode_mtr'), nama: get(c, 'nama'), no_hp: get(c, 'no_hp'), ds: get(c, 'ds'), status: STATUS[norm(st)] ?? st }
        })
        .filter((r) => r.kode_mtr || r.nama || r.no_hp || r.ds),
    )
    setFile(f.name)
  }

  async function run() {
    setBusy(true)
    const { data, error } = await sb.rpc('import_riders', { p_rows: rows })
    setBusy(false)
    if (error) return toast(error.message)
    setHasil(data as Hasil)
    setRows([])
    setFile('')
    done()
  }

  return (
    <div className="card">
      <b className="block mb-1">Import CSV rider</b>
      <p className="text-xs text-muted-foreground mb-3">
        Wajib: kode MTR dan nama. Opsional: no_hp, ds, status (aktif / nonaktif). Nama kolom fleksibel (mis. <i>employee_id</i>, <i>full_name</i>, <i>kode mitra</i> juga dikenali). Nama DS harus persis sama dengan DS yang sudah dibuat. Rider yang sudah ada di-update, yang baru ditambah, yang tidak ada di file dibiarkan.{' '}
        <button className="underline" onClick={() => download('template-rider.csv', 'kode_mtr,nama,no_hp,ds,status\r\nMTR001,Budi,0812xxxx,Galaxy,aktif')}>
          Unduh template
        </button>
      </p>
      <input type="file" accept=".csv,text/csv" disabled={busy} className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3.5 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:border-foreground/50" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      {rows.length > 0 && (
        <div className="mt-4">
          <p className="text-sm mb-2"><b>{file}</b> — {rows.length} baris siap diimpor. Ini 5 baris pertama:</p>
          <div className="overflow-x-auto mb-3">
            <table className="tbl">
              <thead><tr><th>Baris</th><th>Kode MTR</th><th>Nama</th><th>No HP</th><th>DS</th><th>Status</th></tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r) => (
                  <tr key={r.baris}><td>{r.baris}</td><td>{r.kode_mtr}</td><td>{r.nama}</td><td>{r.no_hp}</td><td>{r.ds}</td><td>{r.status}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn" disabled={busy} onClick={run}>{busy ? 'Mengimpor…' : `Import ${rows.length} rider`}</button>
          <button className="btn2 ml-2" disabled={busy} onClick={() => { setRows([]); setFile('') }}>Batal</button>
        </div>
      )}
      {hasil && (
        <div className="mt-4 text-sm">
          <p>
            Rider baru: <b>{hasil.inserted}</b> · Diperbarui: <b>{hasil.updated}</b> · Gagal: <b className={hasil.errors.length ? 'text-danger' : ''}>{hasil.errors.length}</b>
          </p>
          <ul className="text-danger">
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
    if (error) return toast(error.message)
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
            <span className="text-muted-foreground/70">{r.ds_nama ?? 'belum punya DS'}</span>
            <button
              className="btn2 ml-auto"
              disabled={r.ds_id === ds.id}
              onClick={async () => {
                if (confirm(`Tarik ${r.nama} dari ${r.ds_nama ?? 'belum punya DS'} ke ${ds.nama}?`) && (await ok(sb.rpc('tarik_rider', { p_rider: r.id })))) {
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
