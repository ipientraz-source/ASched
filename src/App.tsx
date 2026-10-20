import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb, store, useRows, Err, type Ds, type Me } from './lib'
import { RiderApp, JadwalSaya } from './rider'
import { Daily } from './daily'
import { JadwalDs, JadwalSemua } from './jadwal'
import { Dashboard, Rekap } from './rekap'
import { DataRider } from './riders'
import { Kelola } from './kelola'

type P = { me: Me; ds: Ds | null }
type Tab = [string, (p: P) => ReactElement]

const SUPER: Tab[] = [
  ['Dashboard', () => <Dashboard />],
  ['Data Rider', DataRider],
  ['Jadwal', () => <JadwalSemua />],
  ['Laporan Actual', Rekap],
  ['Kelola DS & Captain', () => <Kelola />],
]
const CAPTAIN: Tab[] = [
  ['Jadwal Saya', JadwalSaya],
  ['Daily Report', Daily],
  ['Jadwal DS Saya', JadwalDs],
  ['Rekap DS Saya', Rekap],
  ['Rider DS Saya', DataRider],
]
const RIDER: Tab[] = [['Jadwal Saya', JadwalSaya]]

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [kode, setKode] = useState(() => store.get('kode') ?? '')

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <p className="p-4">Memuat…</p>
  if (session) return <AdminApp email={session.user.email ?? ''} />
  if (kode) return <RiderApp kode={kode} out={() => { store.del('kode'); setKode('') }} />
  return <Login onKode={(k) => { store.set('kode', k); setKode(k) }} />
}

// Satu halaman login, toggle Admin (email+password) / Rider (Kode MTR)
function Login({ onKode }: { onKode: (k: string) => void }) {
  const [tab, setTab] = useState<'admin' | 'rider'>('admin')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    if (tab === 'admin') {
      const { error } = await sb.auth.signInWithPassword({ email: a.trim(), password: b })
      if (error) setErr('Email atau password salah')
    } else {
      const { data } = await sb.rpc('jadwal_rider', { p_kode: a })
      if (data?.length) onKode(a.trim().toUpperCase())
      else setErr('Kode MTR tidak ditemukan atau rider nonaktif')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="max-w-xs mx-auto mt-24 card">
      <h1 className="text-lg font-semibold mb-3 text-center">Dash Scheduler</h1>
      <div className="grid grid-cols-2 mb-3 text-sm">
        {(['admin', 'rider'] as const).map((t) => (
          <button type="button" key={t} onClick={() => { setTab(t); setErr('') }} className={`py-1 border ${tab === t ? 'bg-slate-800 text-white' : 'bg-white'}`}>
            {t === 'admin' ? 'Admin' : 'Rider'}
          </button>
        ))}
      </div>
      <input className="inp w-full mb-2" placeholder={tab === 'admin' ? 'Email' : 'Kode MTR'} value={a} onChange={(e) => setA(e.target.value)} autoFocus />
      {tab === 'admin' && <input className="inp w-full mb-2" type="password" placeholder="Password" value={b} onChange={(e) => setB(e.target.value)} />}
      <Err msg={err} />
      <button className="btn w-full" disabled={busy || !a.trim() || (tab === 'admin' && !b)}>Masuk</button>
    </form>
  )
}

function AdminApp({ email }: { email: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [ds, setDs] = useState<Ds | null>(null)
  const [tab, setTab] = useState(0)

  useEffect(() => {
    ;(async () => {
      const { data } = await sb.from('riders').select('id,nama,peran,ds_id,email').eq('email', email.toLowerCase()).maybeSingle()
      setMe(data as Me | null)
      if (data?.peran === 'captain') {
        const r = await sb.from('ds').select('*').eq('captain_id', data.id).maybeSingle()
        setDs(r.data as Ds | null)
      }
    })()
  }, [email])

  if (me === undefined) return <p className="p-4">Memuat…</p>
  if (me === null)
    return (
      <div className="max-w-sm mx-auto mt-24 card text-center">
        <p className="mb-3">Email <b>{email}</b> belum terdaftar sebagai Captain / Super-admin (atau nonaktif).</p>
        <button className="btn" onClick={() => sb.auth.signOut()}>Keluar</button>
      </div>
    )

  const tabs = me.peran === 'super_admin' ? SUPER : me.peran === 'captain' ? CAPTAIN : RIDER
  const [, View] = tabs[tab] ?? tabs[0]

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex items-center gap-3 mb-3">
        <h1 className="font-semibold">Dash Scheduler</h1>
        <span className="text-sm text-slate-600">{me.nama} · {me.peran.replace('_', '-')}{ds ? ` · ${ds.nama}` : ''}</span>
        <button className="btn2 ml-auto" onClick={() => sb.auth.signOut()}>Keluar</button>
      </header>
      {me.peran === 'captain' && <Notif me={me} />}
      <nav className="flex flex-wrap gap-1 mb-4 border-b border-slate-200">
        {tabs.map(([nama], i) => (
          <button key={nama} onClick={() => setTab(i)} className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${i === tab ? 'border-slate-800 font-medium' : 'border-transparent text-slate-500'}`}>
            {nama}
          </button>
        ))}
      </nav>
      <View key={tab} me={me} ds={ds} />
    </div>
  )
}

// Captain lama dinotifikasi saat ridernya ditarik
function Notif({ me }: { me: Me }) {
  const n = useRows<{ id: string; pesan: string }>(
    () => sb.from('notifikasi').select('id,pesan').eq('penerima_id', me.id).eq('dibaca', false).order('waktu', { ascending: false }),
    [me.id],
  )
  if (!n.rows.length) return null
  return (
    <div className="bg-amber-50 border border-amber-300 rounded p-2 mb-3 text-sm">
      {n.rows.map((x) => (
        <div key={x.id} className="flex gap-2">
          <span>{x.pesan}</span>
          <button className="underline ml-auto" onClick={async () => { await sb.from('notifikasi').update({ dibaca: true }).eq('id', x.id); n.reload() }}>
            tandai dibaca
          </button>
        </div>
      ))}
    </div>
  )
}
