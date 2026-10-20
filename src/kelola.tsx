import { useState } from 'react'
import { sb, useRows, ok, toast, Err, RiderPick, type Ds, type Rider } from './lib'

// Buat / ganti password akun login lewat edge function (service role ada di server, bukan di browser)
async function buatAkun(email: string, password: string) {
  const { error } = await sb.functions.invoke('kelola-admin', { body: { email, password } })
  if (!error) return true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detail = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
  toast(`Akun login gagal dibuat: ${detail ?? error.message}\nAlternatif: buat manual di Supabase → Authentication → Users.`)
  return false
}

export function Kelola() {
  const dsl = useRows<Ds>(() => sb.from('ds').select('*').order('nama'), [])
  const rs = useRows<Rider>(() => sb.from('riders').select('*').order('nama').limit(1000), [])
  const [nama, setNama] = useState('')
  const [cari, setCari] = useState('')
  const candidates = rs.rows.filter((r) => r.peran !== 'super_admin' && r.status === 'aktif')

  return (
    <div>
      <Err msg={dsl.err || rs.err} />
      <div className="card">
        <b className="block mb-2">Buat DS baru</b>
        <div className="flex gap-2">
          <input className="inp" placeholder="Nama DS (mis. Galaxy)" value={nama} onChange={(e) => setNama(e.target.value)} />
          <button
            className="btn"
            disabled={!nama.trim()}
            onClick={async () => {
              if (await ok(sb.from('ds').insert({ nama: nama.trim() }))) {
                setNama('')
                dsl.reload()
              }
            }}
          >
            Buat
          </button>
        </div>
      </div>
      <input className="inp mb-3" placeholder="cari DS / Captain" value={cari} onChange={(e) => setCari(e.target.value)} />
      {dsl.rows
        .filter((d) => (d.nama + (rs.rows.find((r) => r.id === d.captain_id)?.nama ?? '')).toLowerCase().includes(cari.toLowerCase()))
        .map((d) => (
        <DsCard key={d.id} d={d} riders={rs.rows} candidates={candidates} reload={() => { dsl.reload(); rs.reload() }} />
      ))}
      <SuperAdmins admins={rs.rows.filter((r) => r.peran === 'super_admin')} reload={rs.reload} />
    </div>
  )
}

function DsCard({ d, riders, candidates, reload }: { d: Ds; riders: Rider[]; candidates: Rider[]; reload: () => void }) {
  const [f, setF] = useState({ nama: d.nama, kuota_pagi: d.kuota_pagi, kuota_siang: d.kuota_siang, group_wa_id: d.group_wa_id ?? '' })
  const [pick, setPick] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const cap = riders.find((r) => r.id === d.captain_id)

  const simpan = async () => {
    if (await ok(sb.from('ds').update({ nama: f.nama.trim(), kuota_pagi: f.kuota_pagi, kuota_siang: f.kuota_siang, group_wa_id: f.group_wa_id || null }).eq('id', d.id))) { toast.ok('Perubahan DS disimpan'); reload() }
  }
  const tunjuk = async () => {
    if (!(await ok(sb.rpc('tunjuk_captain', { p_ds: d.id, p_rider: pick, p_email: email })))) return
    if (pw) await buatAkun(email, pw)
    setPick(''); setEmail(''); setPw(''); toast.ok('Captain berhasil dipilih')
    reload()
  }

  return (
    <div className="card">
      <div className="flex flex-wrap gap-3 items-end mb-3">
        <div><label className="lbl">Nama DS</label><input className="inp" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} /></div>
        <div><label className="lbl">Kuota pagi</label><input type="number" min={0} className="inp w-20" value={f.kuota_pagi} onChange={(e) => setF({ ...f, kuota_pagi: +e.target.value })} /></div>
        <div><label className="lbl">Kuota siang</label><input type="number" min={0} className="inp w-20" value={f.kuota_siang} onChange={(e) => setF({ ...f, kuota_siang: +e.target.value })} /></div>
        <div><label className="lbl">Group WhatsApp</label><input className="inp" placeholder="Group ID" value={f.group_wa_id} onChange={(e) => setF({ ...f, group_wa_id: e.target.value })} /></div>
        <button className="btn" onClick={simpan}>Simpan</button>
      </div>
      <div className="flex items-center gap-2 mb-2 pt-3 border-t border-zinc-100">
        <span className="lbl !mb-0">Captain</span>
        {cap ? <span className="badge bg-brand-soft text-brand-dark">{cap.nama} · {cap.email}</span> : <span className="badge bg-zinc-200 text-zinc-600">belum ditunjuk</span>}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <RiderPick riders={candidates} value={pick} onChange={setPick} placeholder="Pilih rider yang jadi Captain" />
        <input className="inp" placeholder="Email Captain" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="inp" type="password" placeholder="Password (min. 8 karakter, boleh dikosongkan)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn2" disabled={!pick || !email.trim() || (!!pw && pw.length < 8)} onClick={tunjuk}>Jadikan Captain</button>
      </div>
    </div>
  )
}

function SuperAdmins({ admins, reload }: { admins: Rider[]; reload: () => void }) {
  const [f, setF] = useState({ nama: '', email: '', pw: '' })
  return (
    <div className="card">
      <b className="block mb-2">Super-admin</b>
      <ul className="text-sm mb-3">
        {admins.map((a) => (
          <li key={a.id}>{a.nama} — {a.email}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <input className="inp" placeholder="Nama" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        <input className="inp" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="inp" type="password" placeholder="Password (min. 8 karakter, boleh dikosongkan)" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} />
        <button
          className="btn2"
          disabled={!f.nama.trim() || !f.email.trim() || (!!f.pw && f.pw.length < 8)}
          onClick={async () => {
            if (!(await ok(sb.from('riders').insert({ nama: f.nama.trim(), email: f.email, peran: 'super_admin' })))) return
            if (f.pw) await buatAkun(f.email, f.pw)
            setF({ nama: '', email: '', pw: '' })
            reload()
          }}
        >
          Tambah Super-admin
        </button>
      </div>
    </div>
  )
}
