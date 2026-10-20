import { createClient } from '@supabase/supabase-js'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Inbox, X, type LucideIcon } from 'lucide-react'

export const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

export type Peran = 'rider' | 'captain' | 'super_admin'
export type Me = { id: string; nama: string; peran: Peran; ds_id: string | null; email: string }
export type Ds = { id: string; nama: string; kuota_pagi: number; kuota_siang: number; captain_id: string | null; group_wa_id: string | null }
export type Rider = { id: string; kode_mtr: string | null; nama: string; no_hp: string | null; ds_id: string | null; status: 'aktif' | 'nonaktif'; peran: Peran; email: string | null }

// ── tanggal (WIB, string YYYY-MM-DD agar tidak kena geser zona waktu) ──
export const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
export const monday = (d: string) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7))
export const hari = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

// ── data ──
// ponytail: tanpa react-query; reload manual. PostgREST membatasi 1000 baris per query — cukup untuk skala rider Dash, tambah paginasi bila lewat.
// data: unknown — klien Supabase tanpa tipe salah menebak bentuk embed relasi; bentuk baris dideklarasikan lewat T.
export function useRows<T>(fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, deps: unknown[]) {
  const [rows, setRows] = useState<T[]>([])
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let off = false
    Promise.resolve(fn()).then((r) => {
      if (off) return
      setErr(r.error?.message ?? '')
      setRows((r.data ?? []) as T[])
    })
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { rows, err, reload: () => setN((x) => x + 1) }
}

// Pesan teknis dari database diterjemahkan agar mudah dipahami; pesan yang sudah berbahasa Indonesia dibiarkan.
const ramah = (m: string) =>
  /row-level security|permission denied/i.test(m) ? 'Anda tidak punya izin untuk tindakan ini.'
  : /duplicate key/i.test(m) ? 'Data sudah ada. Kode MTR, email, dan nama DS tidak boleh kembar.'
  : /failed to fetch|network/i.test(m) ? 'Koneksi bermasalah. Periksa internet Anda lalu coba lagi.'
  : /invalid input syntax/i.test(m) ? 'Isian tidak valid. Periksa lagi data yang dimasukkan.'
  : m

export async function ok(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  if (error) toast(ramah(error.message))
  return !error
}

// ── notifikasi (menggantikan alert bawaan browser) ──
type Toast = { id: number; msg: string; tone: 'ok' | 'err' }
let pushToast: (t: Toast) => void = () => {}
let toastId = 0
const emit = (msg: string, tone: Toast['tone']) => pushToast({ id: ++toastId, msg, tone })
export const toast = Object.assign((msg: string) => emit(msg, 'err'), { ok: (msg: string) => emit(msg, 'ok') })

export function Toaster() {
  const [list, setList] = useState<Toast[]>([])
  useEffect(() => {
    pushToast = (t) => {
      setList((l) => [...l, t])
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 5000)
    }
    return () => {
      pushToast = () => {}
    }
  }, [])
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 w-96 max-w-[calc(100vw-2rem)]">
      {list.map((t) => (
        <div key={t.id} className={`rise flex items-start gap-3 rounded-xl border bg-white p-3.5 shadow-xl text-sm ${t.tone === 'ok' ? 'border-brand/30' : 'border-red-200'}`}>
          {t.tone === 'ok' ? <CheckCircle2 size={18} className="text-brand shrink-0 mt-0.5" /> : <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />}
          <span className="flex-1">{t.msg}</span>
          <button onClick={() => setList((l) => l.filter((x) => x.id !== t.id))} className="text-zinc-400 hover:text-ink"><X size={16} /></button>
        </div>
      ))}
    </div>
  )
}

// Kartu angka dengan ikon
export function Stat({ icon: Icon, label, value, tone = 'brand' }: { icon: LucideIcon; label: string; value: ReactNode; tone?: 'brand' | 'red' | 'zinc' }) {
  const warna = { brand: 'bg-brand-soft text-brand', red: 'bg-red-50 text-red-600', zinc: 'bg-zinc-100 text-zinc-600' }[tone]
  return (
    <div className="stat flex items-center gap-4">
      <div className={`size-12 shrink-0 rounded-xl flex items-center justify-center ${warna}`}><Icon size={22} /></div>
      <div className="min-w-0">
        <b className={tone === 'red' ? '!text-red-600' : ''}>{value}</b>
        <span>{label}</span>
      </div>
    </div>
  )
}

export const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* private mode */
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* private mode */
    }
  },
}

// ── CSV ──
export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\r\n')
}
export function download(name: string, csv: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })) // BOM agar Excel baca UTF-8
  a.download = name
  a.click()
}
// Pemisah , atau ; (Excel locale Indonesia menyimpan CSV dengan ;)
export function parseCsv(t: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let f = ''
  let q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          f += '"'
          i++
        } else q = false
      } else f += c
    } else if (c === '"') q = true
    else if (c === ',' || c === ';') {
      row.push(f)
      f = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(f)
      out.push(row)
      row = []
      f = ''
    } else f += c
  }
  if (f || row.length) {
    row.push(f)
    out.push(row)
  }
  return out
}

// ── komponen kecil ──
// Pencarian + dropdown rider (cari nama / Kode MTR)
export function RiderPick({
  riders,
  value,
  onChange,
  placeholder,
}: {
  riders: { id: string; nama: string; kode_mtr?: string | null }[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const f = riders.filter((r) => (r.nama + ' ' + (r.kode_mtr ?? '')).toLowerCase().includes(q.toLowerCase())).slice(0, 50)
  return (
    <span className="inline-flex gap-1">
      <input className="inp w-24" placeholder="cari…" value={q} onChange={(e) => setQ(e.target.value)} />
      <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder ?? '— pilih —'}</option>
        {f.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nama}
            {r.kode_mtr ? ` (${r.kode_mtr})` : ''}
          </option>
        ))}
      </select>
    </span>
  )
}

export const Err = ({ msg }: { msg: string }) =>
  msg ? <p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-200 rounded-md px-3 py-2">{msg}</p> : null

export const Logo = ({ small }: { small?: boolean }) => (
  <div className={`${small ? 'size-9 text-base' : 'size-12 text-xl'} shrink-0 rounded-xl bg-brand text-white font-display font-bold flex items-center justify-center shadow-lg shadow-brand/30`}>D</div>
)

export const Kosong = ({ teks, hint }: { teks: string; hint?: string }) => (
  <div className="flex flex-col items-center text-center py-10 text-zinc-500">
    <div className="size-12 rounded-full bg-zinc-100 flex items-center justify-center mb-3"><Inbox size={22} className="text-zinc-400" /></div>
    <p className="font-semibold text-zinc-700">{teks}</p>
    {hint && <p className="text-sm mt-1 max-w-xs">{hint}</p>}
  </div>
)
