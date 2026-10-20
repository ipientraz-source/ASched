import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

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

export async function ok(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  if (error) alert(error.message)
  return !error
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

export const Err = ({ msg }: { msg: string }) => (msg ? <p className="text-red-600 text-sm mb-2">{msg}</p> : null)
