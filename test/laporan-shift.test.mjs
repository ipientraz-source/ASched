// Uji laporan absensi per shift (laporan_ds: pagi_belum_isi dan siang_belum_isi), di Postgres (PGlite).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local'
const GALAXY = id(101)
const [P1, P2, S1, S2] = [id(21), id(22), id(23), id(24)]

const q = async (sql, p) => (await db.query(sql, p)).rows
async function sebagaiSuper(fn) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify({ email: S })}', false); set role authenticated`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`)
  }
}
const laporan = async () => (await sebagaiSuper(() => q(`select pagi_belum_isi, siang_belum_isi, hari_belum_isi from laporan_ds(today_wib() - 1, today_wib())`)))[0]
// siang hari ini baru dihitung setelah pukul 22:00 WIB; tes ikut jam sebenarnya supaya lulus kapan pun dijalankan
const lewat22 = async () => (await q(`select (now() at time zone 'Asia/Jakarta')::time >= time '22:00' as ya`))[0].ya
const isi = (tgl, rider) => db.query(`insert into actual_harian (tanggal, rider_id, ds_id, status, potongan) values (${tgl}, '${rider}', '${GALAXY}', 'hadir', null)`)

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;`)
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
  await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated')
  await db.exec(`
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 2, 2);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${P1}', 'MTR021', 'Pagi Satu', '${GALAXY}', 'rider', null, 'aktif'),
      ('${P2}', 'MTR022', 'Pagi Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${S1}', 'MTR023', 'Siang Satu', '${GALAXY}', 'rider', null, 'aktif'),
      ('${S2}', 'MTR024', 'Siang Dua', '${GALAXY}', 'rider', null, 'aktif');
    insert into jadwal (tanggal, rider_id, shift, ds_id)
      select t, r::uuid, s::shift_t, '${GALAXY}' from (values (today_wib() - 1), (today_wib())) d(t),
        (values ('${P1}', 'pagi'), ('${P2}', 'pagi'), ('${S1}', 'siang'), ('${S2}', 'siang')) x(r, s);`)
})
after(() => db.close())

test('belum ada absensi: pagi kemarin dan hari ini terhitung belum diisi; siang hari ini baru terhitung setelah 22:00 WIB', async () => {
  const l = await laporan()
  assert.equal(l.pagi_belum_isi, 2)
  assert.equal(l.siang_belum_isi, (await lewat22()) ? 2 : 1)
})

test('shift pagi dilaporkan lebih dulu: pagi terhitung terisi walau siang di hari yang sama belum', async () => {
  await isi('today_wib()', P1) // cukup satu rider pagi hari ini yang diabsen
  const l = await laporan()
  assert.equal(l.pagi_belum_isi, 1) // tinggal pagi kemarin
  assert.equal(l.siang_belum_isi, (await lewat22()) ? 2 : 1)
  assert.equal(l.hari_belum_isi, 1) // ukuran lama per hari: hari ini sudah ada isian, kemarin belum
})

test('pagi kemarin diisi: pagi bersih; siang kemarin masih terhitung sampai diisi', async () => {
  await isi('today_wib() - 1', P1)
  const siangHariIni = (await lewat22()) ? 1 : 0 // siang hari ini ikut terhitung setelah 22:00
  assert.deepEqual({ ...(await laporan()) }, { pagi_belum_isi: 0, siang_belum_isi: 1 + siangHariIni, hari_belum_isi: 0 })
  await isi('today_wib() - 1', S2)
  assert.deepEqual({ ...(await laporan()) }, { pagi_belum_isi: 0, siang_belum_isi: siangHariIni, hari_belum_isi: 0 })
  await isi('today_wib()', S1) // siang hari ini dilaporkan: bersih kapan pun jamnya
  assert.deepEqual({ ...(await laporan()) }, { pagi_belum_isi: 0, siang_belum_isi: 0, hari_belum_isi: 0 })
})
