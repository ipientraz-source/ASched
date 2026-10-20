// Unduh jadwal sebagai gambar (PNG) atau PDF.
// Semuanya dibuat di browser lalu langsung diunduh: tidak ada yang diunggah atau disimpan di database.
import { useEffect, useRef } from 'react'

export type DataCetak = {
  judul: string
  days: string[]
  riders: { id: string; nama: string; kode_mtr: string | null }[]
  g: Record<string, string> // "riderId|tanggal" -> pagi | siang | off (libur terkunci)
  kuota: Record<string, { pagi: number; siang: number; cadangan: number }> // kebutuhan client per tanggal
}

const NAMA_HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const namaHari = (d: string) => NAMA_HARI[(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7]
const bulanDi = (d: string) => NAMA_BULAN[+d.slice(5, 7) - 1]
const tanggalPanjang = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const potong = <T,>(l: T[], n: number) => (l.length ? Array.from({ length: Math.ceil(l.length / n) }, (_, i) => l.slice(i * n, (i + 1) * n)) : [[] as T[]])

// Hijau = pas, kuning = kurang; kelebihan: biru bila masih dalam jatah cadangan, merah bila melebihi
const warnaKuota = (n: number, q: number, lebihTotal: number, cad: number) => (n === q ? 'text-success' : n < q ? 'text-warning' : lebihTotal <= cad ? 'text-primary' : 'text-danger')

function Sel({ v, padat }: { v: string; padat: boolean }) {
  if (!v) return <span className="text-muted-foreground/40">·</span>
  if (v === 'off')
    return padat ? (
      <span className="inline-flex size-6 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">C</span>
    ) : (
      <span className="inline-block w-[4.5rem] rounded-lg border border-border bg-muted px-2 py-1.5 text-xs font-semibold text-muted-foreground">Cuti</span>
    )
  const pagi = v === 'pagi'
  if (padat)
    return <span className={`inline-flex size-6 items-center justify-center rounded text-[11px] font-bold ${pagi ? 'bg-warning-soft text-warning' : 'bg-primary-soft text-primary-soft-foreground'}`}>{pagi ? 'P' : 'S'}</span>
  return (
    <span className={`inline-block w-[4.5rem] rounded-lg border px-2 py-1.5 text-xs font-semibold ${pagi ? 'border-warning/30 bg-warning-soft text-warning' : 'border-primary/30 bg-primary-soft text-primary-soft-foreground'}`}>
      {pagi ? 'Pagi' : 'Siang'}
    </span>
  )
}

export function Cetak({ data, mode, onSelesai }: { data: DataCetak; mode: 'png' | 'pdf'; onSelesai: (galat?: string) => void }) {
  const { days, riders, g } = data
  const akar = useRef<HTMLDivElement>(null)
  const padat = days.length > 10 // periode panjang: sel ringkas (huruf P / S)
  const lebarSel = padat ? 30 : 84
  const lebar = Math.max(1000, 56 + 270 + 84 + days.length * lebarSel)
  const tinggiPdf = Math.round((lebar * 210) / 297) // rasio A4 landscape
  const barisH = padat ? 34 : 46
  const sisa = tinggiPdf - 150 - (padat ? 92 : 70) - 78 - 40 - 56
  const perHalaman = Math.max(4, Math.floor(sisa / barisH))
  const halaman = mode === 'pdf' ? potong(riders, perHalaman) : [riders] // PNG: satu gambar utuh; PDF: dibagi per halaman
  const awal = days[0]
  const akhir = days[days.length - 1]
  const dicetak = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' })
  const hitung = (d: string, s: string) => riders.filter((r) => g[`${r.id}|${d}`] === s).length

  useEffect(() => {
    let batal = false
    ;(async () => {
      try {
        // library berat dimuat hanya saat tombol unduh diklik, supaya tidak membebani halaman utama
        const [{ toJpeg, toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')])
        const lembar = [...(akar.current?.querySelectorAll<HTMLElement>('[data-lembar]') ?? [])]
        const gambar: string[] = []
        const opsi = { pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: true, cacheBust: true }
        // PDF memakai JPEG: jsPDF memasukkannya apa adanya (cepat, berkas kecil); PNG harus dikompres ulang dan lambat
        for (const n of lembar) gambar.push(mode === 'pdf' ? await toJpeg(n, { ...opsi, quality: 0.92 }) : await toPng(n, opsi))
        if (batal) return
        const nama = `${slug(data.judul)}_${awal}_${akhir}`
        if (mode === 'png') {
          const a = document.createElement('a')
          a.href = gambar[0]
          a.download = nama + '.png'
          a.click()
        } else {
          const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
          gambar.forEach((url, i) => {
            if (i) pdf.addPage()
            pdf.addImage(url, 'JPEG', 0, 0, 297, 210)
          })
          pdf.save(nama + '.pdf')
        }
        onSelesai()
      } catch (e) {
        onSelesai((e as Error).message)
      }
    })()
    return () => {
      batal = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={akar} aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
      {halaman.map((rows, hal) => (
        <div key={hal} data-lembar className="cetak flex flex-col" style={{ width: lebar, height: mode === 'pdf' ? tinggiPdf : undefined, padding: 28, boxSizing: 'border-box' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-2xl font-bold">{data.judul}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Periode {tanggalPanjang(awal)} – {tanggalPanjang(akhir)} · {days.length} hari
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">Dash Scheduler</div>
              <div>Dicetak {dicetak}</div>
              {halaman.length > 1 && <div>Halaman {hal + 1} dari {halaman.length}</div>}
            </div>
          </div>
          <div className="mb-3 mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Sel v="pagi" padat={false} /> shift pagi</span>
            <span className="flex items-center gap-1.5"><Sel v="siang" padat={false} /> shift siang</span>
            <span className="flex items-center gap-1.5"><Sel v="off" padat={false} /> cuti terkunci</span>
            <span className="flex items-center gap-1.5"><Sel v="" padat={false} /> kosong = libur biasa</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }} className="text-sm">
            <colgroup>
              <col style={{ width: 270 }} />
              {days.map((d) => <col key={d} style={{ width: lebarSel }} />)}
              <col style={{ width: 84 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rider</th>
                {days.map((d, i) => {
                  const akhirPekan = ['Sab', 'Min'].includes(namaHari(d))
                  const tandaBulan = i === 0 || d.slice(8) === '01'
                  return (
                    <th key={d} className={`py-1.5 text-center ${akhirPekan ? 'bg-muted' : ''}`}>
                      <div className="h-3 text-[9px] font-semibold uppercase text-primary">{tandaBulan ? bulanDi(d) : ''}</div>
                      <div className={`font-mono font-semibold uppercase text-muted-foreground ${padat ? 'text-[9px]' : 'text-[10px]'}`}>{namaHari(d)}</div>
                      <div className={`font-bold ${padat ? 'text-xs' : 'text-base'}`}>{d.slice(8)}</div>
                    </th>
                  )
                })}
                <th className="py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Hari kerja</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border" style={{ height: barisH }}>
                  <td className="truncate pr-2">
                    <span className="font-medium">{r.nama}</span> <span className="font-mono text-[11px] text-muted-foreground">{r.kode_mtr}</span>
                  </td>
                  {days.map((d) => (
                    <td key={d} className={`text-center ${['Sab', 'Min'].includes(namaHari(d)) ? 'bg-muted/50' : ''}`}>
                      <Sel v={g[`${r.id}|${d}`] ?? ''} padat={padat} />
                    </td>
                  ))}
                  <td className="text-center font-mono font-semibold">{days.filter((d) => ['pagi', 'siang'].includes(g[`${r.id}|${d}`])).length}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={days.length + 2} className="py-8 text-center text-muted-foreground">Belum ada rider aktif di DS ini.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-muted">
                <td className="py-2 pl-2 text-xs font-semibold">
                  Terisi / kebutuhan client
                  <div className="text-[10px] font-normal text-muted-foreground">Kebutuhan bisa berbeda tiap hari; +cad = rider cadangan</div>
                </td>
                {days.map((d) => {
                  const p = hitung(d, 'pagi')
                  const s = hitung(d, 'siang')
                  const k = data.kuota[d] ?? { pagi: 0, siang: 0, cadangan: 0 }
                  const lebih = Math.max(0, p - k.pagi) + Math.max(0, s - k.siang)
                  return (
                    <td key={d} className="py-1.5 text-center font-mono text-[10px] font-semibold leading-snug">
                      <div className={warnaKuota(p, k.pagi, lebih, k.cadangan)}>{padat ? `P${p}` : `P ${p}/${k.pagi}`}</div>
                      <div className={warnaKuota(s, k.siang, lebih, k.cadangan)}>{padat ? `S${s}` : `S ${s}/${k.siang}`}</div>
                      {k.cadangan > 0 && !padat && <div className="text-[9px] font-normal text-muted-foreground">+{k.cadangan} cad</div>}
                    </td>
                  )
                })}
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="mt-auto pt-3 text-[10px] text-muted-foreground">Dibuat dengan Dash Scheduler. Warna hijau pada kuota berarti jumlah rider pas, kuning kurang, merah kelebihan.</div>
        </div>
      ))}
    </div>
  )
}
