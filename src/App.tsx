import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BellRing, Building2, CalendarCheck, CalendarDays, ClipboardCheck, ClipboardList, LayoutDashboard, LogOut, ShieldCheck, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import { sb, store, useRows, Err, Logo, type Ds, type Me } from './lib'
import { RiderApp, JadwalSaya } from './rider'
import { Daily } from './daily'
import { JadwalDs, JadwalSemua } from './jadwal'
import { Dashboard, Rekap } from './rekap'
import { DataRider } from './riders'
import { Kelola } from './kelola'

type P = { me: Me; ds: Ds | null }
type Tab = { nama: string; desc: string; Icon: LucideIcon; View: (p: P) => ReactElement }

const SUPER: Tab[] = [
  { nama: 'Dashboard', desc: 'Ringkasan kepatuhan jadwal dan keaktifan Captain per DS', Icon: LayoutDashboard, View: () => <Dashboard /> },
  { nama: 'Data Rider', desc: 'Penggolongan rider ke DS, status aktif/nonaktif, import & ekspor CSV', Icon: Users, View: DataRider },
  { nama: 'Jadwal', desc: 'Jadwal seluruh DS (hanya lihat — penyusunan dilakukan Captain)', Icon: CalendarDays, View: () => <JadwalSemua /> },
  { nama: 'Laporan Actual', desc: 'Selisih rencana vs kenyataan, rekap per rider, dan kunci periode', Icon: ClipboardList, View: Rekap },
  { nama: 'Kelola DS & Captain', desc: 'Buat DS, atur kuota, tunjuk Captain dan Super-admin', Icon: Building2, View: () => <Kelola /> },
]
const CAPTAIN: Tab[] = [
  { nama: 'Jadwal Saya', desc: 'Jadwal kerja Anda sebagai rider', Icon: CalendarCheck, View: JadwalSaya },
  { nama: 'Daily Report', desc: 'Tandai siapa yang benar-benar masuk hari ini', Icon: ClipboardCheck, View: Daily },
  { nama: 'Jadwal DS Saya', desc: 'Susun jadwal rider di DS Anda per minggu', Icon: CalendarDays, View: JadwalDs },
  { nama: 'Rekap DS Saya', desc: 'Kepatuhan, alpha, dan pengganti di DS Anda', Icon: TrendingUp, View: Rekap },
  { nama: 'Rider DS Saya', desc: 'Kelola rider DS Anda dan tarik rider dari DS lain', Icon: Users, View: DataRider },
]
const RIDER: Tab[] = [{ nama: 'Jadwal Saya', desc: 'Jadwal kerja Anda', Icon: CalendarCheck, View: JadwalSaya }]

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [kode, setKode] = useState(() => store.get('kode') ?? '')

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <p className="p-6 text-zinc-500">Memuat…</p>
  if (session) return <AdminApp email={session.user.email ?? ''} />
  if (kode) return <RiderApp kode={kode} out={() => { store.del('kode'); setKode('') }} />
  return <Login onKode={(k) => { store.set('kode', k); setKode(k) }} />
}

const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

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
    <div className="min-h-screen md:grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between p-12 text-white bg-gradient-to-br from-brand via-brand to-brand-dark relative overflow-hidden">
        <div className="absolute -right-24 -bottom-24 size-96 rounded-full bg-white/10" />
        <div className="absolute -right-4 top-32 size-40 rounded-full bg-white/5" />
        <div className="flex items-center gap-3 relative">
          <div className="size-10 rounded-xl bg-white text-brand font-display font-bold text-lg flex items-center justify-center">D</div>
          <div className="font-display font-bold text-lg">Dash Electric</div>
        </div>
        <div className="relative">
          <h2 className="text-4xl font-bold leading-tight mb-4">Jadwal rapi.<br />Kehadiran terpantau.</h2>
          <p className="text-white/80 max-w-sm mb-8">Captain menyusun jadwal dan mencatat kehadiran harian per DS. Super-admin membaca selisih rencana dan kenyataan tanpa hitung manual.</p>
          <ul className="space-y-3 text-sm">
            {[
              [CalendarDays, 'Jadwal per DS disusun langsung oleh Captain'],
              [ClipboardCheck, 'Daily report cepat — satu klik untuk hadir'],
              [ShieldCheck, 'Akses terkunci per DS di tingkat database'],
            ].map(([I, t]) => {
              const Icon = I as LucideIcon
              return (
                <li key={t as string} className="flex items-center gap-3">
                  <span className="size-8 rounded-lg bg-white/15 flex items-center justify-center"><Icon size={16} /></span>
                  {t as string}
                </li>
              )
            })}
          </ul>
        </div>
        <div className="relative font-mono text-[11px] uppercase tracking-widest text-white/60">Sistem internal · Dash Scheduler</div>
      </div>

      <div className="flex items-center justify-center p-6 min-h-screen md:min-h-0">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="md:hidden flex items-center gap-3 mb-8">
            <Logo />
            <div className="font-display font-bold text-xl">Dash Scheduler</div>
          </div>
          <h1 className="text-2xl font-bold mb-1">Masuk</h1>
          <p className="text-sm text-zinc-500 mb-6">Pilih cara masuk sesuai peran Anda.</p>
          <div className="grid grid-cols-2 gap-1 p-1 mb-5 rounded-lg bg-zinc-100">
            {(['admin', 'rider'] as const).map((t) => (
              <button type="button" key={t} onClick={() => { setTab(t); setErr('') }} className={`tab text-center ${tab === t ? 'tab-on' : ''}`}>
                {t === 'admin' ? 'Captain / Admin' : 'Rider'}
              </button>
            ))}
          </div>
          <label className="lbl">{tab === 'admin' ? 'Email' : 'Kode MTR'}</label>
          <input className="inp w-full mb-4 !py-2.5" value={a} onChange={(e) => setA(e.target.value)} autoFocus placeholder={tab === 'admin' ? 'nama@dashelectric.co' : 'MTR001'} />
          {tab === 'admin' && (
            <>
              <label className="lbl">Password</label>
              <input className="inp w-full mb-4 !py-2.5" type="password" value={b} onChange={(e) => setB(e.target.value)} />
            </>
          )}
          <Err msg={err} />
          <button className="btn btn-lg w-full" disabled={busy || !a.trim() || (tab === 'admin' && !b)}>{busy ? 'Memproses…' : 'Masuk'}</button>
          <p className="text-xs text-zinc-400 mt-6 text-center">Akun Captain dibuat oleh Super-admin. Lupa password? Hubungi Super-admin.</p>
        </form>
      </div>
    </div>
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

  if (me === undefined) return <p className="p-6 text-zinc-500">Memuat…</p>
  if (me === null)
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm card text-center !p-6">
          <ShieldCheck className="mx-auto mb-3 text-zinc-400" size={32} />
          <p className="mb-4 text-sm">Email <b>{email}</b> belum terdaftar sebagai Captain / Super-admin (atau nonaktif).</p>
          <button className="btn" onClick={() => sb.auth.signOut()}>Keluar</button>
        </div>
      </div>
    )

  const tabs = me.peran === 'super_admin' ? SUPER : me.peran === 'captain' ? CAPTAIN : RIDER
  const cur = tabs[tab] ?? tabs[0]
  const peran = me.peran.replace('_', '-')
  const tgl = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-ink text-zinc-400 p-4 sticky top-0 h-screen">
        <div className="flex items-center gap-3 px-2 mb-8 mt-1">
          <Logo small />
          <div>
            <div className="font-display font-bold text-white leading-none">Dash</div>
            <div className="font-mono text-[10px] tracking-widest uppercase mt-1">Scheduler</div>
          </div>
        </div>
        <nav className="space-y-1 flex-1">
          {tabs.map((t, i) => (
            <button key={t.nama} onClick={() => setTab(i)} className={`nav ${i === tab ? 'nav-on' : ''}`}>
              <t.Icon size={18} />
              {t.nama}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 pt-4 flex items-center gap-3">
          <div className="size-9 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center">{initials(me.nama)}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-sm font-semibold text-white truncate">{me.nama}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider truncate">{peran}{ds ? ` · ${ds.nama}` : ''}</div>
          </div>
          <button onClick={() => sb.auth.signOut()} title="Keluar" className="p-2 rounded-md hover:bg-white/10 hover:text-white"><LogOut size={16} /></button>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="md:hidden bg-ink text-white px-4 py-3 flex items-center gap-3">
          <Logo small />
          <div className="flex-1 leading-tight min-w-0">
            <div className="text-sm font-semibold truncate">{me.nama}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 truncate">{peran}{ds ? ` · ${ds.nama}` : ''}</div>
          </div>
          <button onClick={() => sb.auth.signOut()} className="p-2"><LogOut size={18} /></button>
        </div>
        <nav className="md:hidden flex gap-1 p-2 bg-white border-b border-zinc-200 overflow-x-auto">
          {tabs.map((t, i) => (
            <button key={t.nama} onClick={() => setTab(i)} className={`tab ${i === tab ? 'tab-on' : ''}`}>{t.nama}</button>
          ))}
        </nav>

        <header className="px-4 md:px-8 pt-6 pb-5 flex flex-wrap items-end gap-2 border-b border-zinc-200 bg-white">
          <div className="flex-1 min-w-60">
            <h2 className="text-2xl font-bold">{cur.nama}</h2>
            <p className="text-sm text-zinc-500 mt-0.5">{cur.desc}</p>
          </div>
          <span className="font-mono text-xs text-zinc-500 bg-zinc-100 rounded-full px-3 py-1">{tgl}</span>
        </header>
        <main className="px-4 md:px-8 py-6 max-w-6xl">
          {me.peran === 'captain' && <Notif me={me} />}
          <cur.View key={tab} me={me} ds={ds} />
        </main>
      </div>
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
    <div className="bg-brand-soft border border-brand/30 rounded-xl p-3 mb-4 text-sm space-y-1">
      {n.rows.map((x) => (
        <div key={x.id} className="flex items-center gap-2">
          <BellRing size={16} className="text-brand shrink-0" />
          <span>{x.pesan}</span>
          <button className="underline text-brand-dark ml-auto shrink-0" onClick={async () => { await sb.from('notifikasi').update({ dibaca: true }).eq('id', x.id); n.reload() }}>
            tandai dibaca
          </button>
        </div>
      ))}
    </div>
  )
}
