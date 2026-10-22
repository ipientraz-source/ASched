// Uji hapus jadwal mingguan (hanya Super-admin; terlindungi bila sudah ada absensi atau dikunci), di Postgres (PGlite).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-galaxy@test.local', AA = 'arcon-a@test.local'
const GALAXY = id(101), ALSUT = id(102)
const R_G = id(21), R_A = id(22)
const SENIN = '2031-03-03', SENIN2 = '2031-03-10', SENIN3 = '2031-03-17'

const q = async (sql, p) => (await db.query(sql, p)).rows
async function as(email, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify({ email })}', false); set role authenticated`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`)
  }
}
const hapus = (ds, minggu) => q('select hapus_jadwal($1, $2) as n', [ds, minggu])
const jumlah = async (ds, dari, sampai) => Number((await q('select count(*) n from jadwal where ds_id = $1 and tanggal between $2 and $3', [ds, dari, sampai]))[0].n)

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 1, 1), ('${ALSUT}', 'Alam Sutera', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${id(10)}', 'MTR-CG', 'Captain Galaxy', '${GALAXY}', 'captain', '${CG}', 'aktif'),
      ('${id(30)}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif'),
      ('${R_G}', 'MTR021', 'Rider Galaxy', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_A}', 'MTR022', 'Rider Alsut', '${ALSUT}', 'rider', null, 'aktif');
    update ds set captain_id = '${id(10)}', arcon_id = '${id(30)}' where id = '${GALAXY}';
    insert into jadwal (tanggal, rider_id, shift, ds_id) values
      ('${SENIN}', '${R_G}', 'pagi', '${GALAXY}'), ('2031-03-09', '${R_G}', 'off', '${GALAXY}'),
      ('${SENIN2}', '${R_G}', 'siang', '${GALAXY}'), ('${SENIN3}', '${R_G}', 'pagi', '${GALAXY}'),
      ('${SENIN}', '${R_A}', 'pagi', '${ALSUT}');
    insert into actual_harian (tanggal, rider_id, ds_id, status, potongan) values ('${SENIN2}', '${R_G}', '${GALAXY}', 'hadir', null);
    insert into periode_kunci (ds_id, minggu_mulai) values ('${GALAXY}', '${SENIN3}');`)
})
after(() => db.close())

test('Captain dan Arcon tidak bisa menghapus jadwal', async () => {
  for (const e of [CG, AA]) await as(e, () => assert.rejects(() => hapus(GALAXY, SENIN), /Hanya Super-admin/))
  assert.equal(await jumlah(GALAXY, SENIN, '2031-03-09'), 2)
})

test('Super-admin menghapus jadwal satu DS satu minggu (tanggal mana pun di minggu itu), DS lain tidak tersentuh', async () => {
  const n = await as(S, () => hapus(GALAXY, '2031-03-06')) // Kamis di minggu yang sama
  assert.equal(n[0].n, 2) // pagi + off terkunci
  assert.equal(await jumlah(GALAXY, SENIN, '2031-03-09'), 0)
  assert.equal(await jumlah(ALSUT, SENIN, '2031-03-09'), 1)
  assert.equal(await jumlah(GALAXY, SENIN2, SENIN3), 2) // minggu lain utuh
  const log = await q(`select aksi, detail from log_aktivitas where aksi = 'hapus jadwal'`)
  assert.equal(log.length, 1)
  assert.match(log[0].detail, /Galaxy/)
})

test('minggu tanpa jadwal ditolak dengan pesan jelas', async () => {
  await as(S, () => assert.rejects(() => hapus(GALAXY, SENIN), /Tidak ada jadwal untuk dihapus/))
})

test('minggu yang sudah ada absensi atau sudah dikunci tidak bisa dihapus', async () => {
  await as(S, async () => {
    await assert.rejects(() => hapus(GALAXY, SENIN2), /sudah ada absensi/)
    await assert.rejects(() => hapus(GALAXY, SENIN3), /sudah dikunci/)
  })
  assert.equal(await jumlah(GALAXY, SENIN2, SENIN3), 2)
})

test('DS yang tidak ada ditolak', async () => {
  await as(S, () => assert.rejects(() => hapus(id(999), SENIN), /DS tidak ditemukan/))
})
