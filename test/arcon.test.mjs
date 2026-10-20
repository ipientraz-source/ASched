// Uji peran Arcon: atasan Captain yang memegang beberapa DS (RLS + RPC), di Postgres (PGlite).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const S = 'super@test.local', CG = 'cap-galaxy@test.local', AA = 'arcon-a@test.local', AB = 'arcon-b@test.local'
const GALAXY = id(101), ALSUT = id(102), GOWA = id(103)
const [R_CG, R_CA, R_CW, R_AA, R_AB, R_G, R_A, R_W] = [id(10), id(11), id(12), id(30), id(31), id(21), id(22), id(23)]

const q = async (sql, p) => (await db.query(sql, p)).rows
async function as(email, fn) {
  const claims = JSON.stringify(email ? { email } : {})
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${email ? 'authenticated' : 'anon'}`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`)
  }
}
const nama = async () => (await q('select nama from riders order by nama')).map((r) => r.nama)

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 1, 1), ('${ALSUT}', 'Alam Sutera', 1, 1), ('${GOWA}', 'Gowa', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', '${S}', 'aktif'),
      ('${R_CG}', 'MTR-CG', 'Captain Galaxy', '${GALAXY}', 'captain', '${CG}', 'aktif'),
      ('${R_CA}', 'MTR-CA', 'Captain Alsut', '${ALSUT}', 'captain', 'cap-alsut@test.local', 'aktif'),
      ('${R_CW}', 'MTR-CW', 'Captain Gowa', '${GOWA}', 'captain', 'cap-gowa@test.local', 'aktif'),
      ('${R_AA}', null, 'Arcon A', null, 'arcon', '${AA}', 'aktif'),
      ('${R_AB}', null, 'Arcon B', null, 'arcon', '${AB}', 'aktif'),
      ('${R_G}', 'MTR021', 'Rider Galaxy', '${GALAXY}', 'rider', null, 'aktif'),
      ('${R_A}', 'MTR022', 'Rider Alsut', '${ALSUT}', 'rider', null, 'aktif'),
      ('${R_W}', 'MTR023', 'Rider Gowa', '${GOWA}', 'rider', null, 'aktif'),
      ('${id(24)}', 'MTR024', 'Rider Bebas', null, 'rider', null, 'aktif');
    update ds set captain_id = '${R_CG}', arcon_id = '${R_AA}' where id = '${GALAXY}';
    update ds set captain_id = '${R_CA}', arcon_id = '${R_AA}' where id = '${ALSUT}';
    update ds set captain_id = '${R_CW}', arcon_id = '${R_AB}' where id = '${GOWA}';
    insert into jadwal (tanggal, rider_id, shift, ds_id) values
      (today_wib(), '${R_G}', 'pagi', '${GALAXY}'), (today_wib(), '${R_A}', 'pagi', '${ALSUT}'), (today_wib(), '${R_W}', 'pagi', '${GOWA}');
    insert into actual_harian (tanggal, rider_id, ds_id, status) values
      (today_wib(), '${R_G}', '${GALAXY}', 'hadir'), (today_wib(), '${R_A}', '${ALSUT}', 'hadir'), (today_wib(), '${R_W}', '${GOWA}', 'hadir');`)
})
after(() => db.close())

test('Arcon A memegang 2 DS: melihat Galaxy + Alam Sutera, TIDAK melihat Gowa', async () => {
  await as(AA, async () => {
    assert.deepEqual(await nama(), ['Arcon A', 'Captain Alsut', 'Captain Galaxy', 'Rider Alsut', 'Rider Galaxy'])
    assert.equal((await q('select * from jadwal')).length, 2)
    assert.equal((await q('select * from actual_harian')).length, 2)
    assert.equal((await q('select * from jadwal where ds_id = $1', [GOWA])).length, 0)
    const lap = await q('select ds_nama from laporan_ds(today_wib(), today_wib())')
    assert.deepEqual(lap.map((x) => x.ds_nama), ['Alam Sutera', 'Galaxy'])
    assert.equal((await q('select * from laporan_rider(today_wib(), today_wib())')).length, 2)
  })
})

test('Arcon B memegang 1 DS: hanya Gowa. Captain tetap hanya DS-nya sendiri', async () => {
  await as(AB, async () => {
    assert.deepEqual(await nama(), ['Arcon B', 'Captain Gowa', 'Rider Gowa'])
    assert.deepEqual((await q('select ds_nama from laporan_ds(today_wib(), today_wib())')).map((x) => x.ds_nama), ['Gowa'])
  })
  await as(CG, async () => {
    assert.deepEqual(await nama(), ['Captain Galaxy', 'Rider Galaxy']) // tidak ikut melihat Alsut walau satu Arcon
  })
})

test('Arcon hanya memantau: tidak bisa menyusun jadwal, mengisi absensi, tarik rider, atau menulis langsung', async () => {
  await as(AA, async () => {
    await assert.rejects(q("select catat_actual(today_wib(), $1::uuid, 'hadir')", [R_G]), /Hanya Captain/)
    await assert.rejects(q('select simpan_jadwal($1::uuid, today_wib(), today_wib(), $2::jsonb)', [GALAXY, '[]']), /Hanya Captain DS ini/)
    await assert.rejects(q('select tarik_rider($1::uuid)', [id(24)]), /Hanya Captain/)
    await assert.rejects(q("insert into actual_harian (tanggal, rider_id, ds_id, status) values (today_wib(), $1, $2, 'alpha')", [R_G, GALAXY]), /row-level security/)
    assert.equal((await q("update riders set status = 'nonaktif' where id = $1 returning id", [R_G])).length, 0)
    assert.equal((await q('update ds set kuota_pagi = 9 where id = $1 returning id', [GALAXY])).length, 0)
    await assert.rejects(q("select set_arcon($1::uuid, $2::uuid, 'x@y.z')", [GOWA, R_AA]), /Hanya Super-admin/)
    await assert.rejects(q('select lepas_arcon($1::uuid)', [GALAXY]), /Hanya Super-admin/)
  })
})

test('Arcon bisa mengunci absensi mingguan DS yang dipegang, bukan DS lain', async () => {
  const d = (await q(`select (date_trunc('week', today_wib()) - interval '7 days')::date::text w`))[0]
  await as(CG, () => q("select catat_actual($1::date, $2::uuid, 'hadir')", [d.w, R_G])) // Captain mengisi minggu lalu
  await as(AA, async () => {
    await assert.rejects(q('select kunci_periode($1::uuid, $2::date)', [GOWA, d.w]), /Tidak berwenang/)
    await q('select kunci_periode($1::uuid, $2::date)', [GALAXY, d.w])
    await q('select kunci_periode($1::uuid, $2::date)', [ALSUT, d.w]) // DS kedua milik Arcon yang sama
  })
  await as(CG, async () => {
    await assert.rejects(q("select catat_actual($1::date, $2::uuid, 'alpha')", [d.w, R_G]), /sudah dikunci/)
  })
})

test('Super-admin menunjuk Arcon: satu Arcon banyak DS; Captain tak bisa merangkap; Arcon lama diturunkan', async () => {
  await as(S, async () => {
    await assert.rejects(q("select set_arcon($1::uuid, $2::uuid, 'x@y.z')", [GALAXY, R_CG]), /Captain/) // Captain tak bisa jadi Arcon
    await assert.rejects(q("select set_arcon($1::uuid, $2::uuid, '')", [GALAXY, R_AA]), /Email Arcon wajib/)
    await assert.rejects(q("select set_arcon($1::uuid, $2::uuid, 'x@y.z')", [GALAXY, id(1)]), /tidak bisa dijadikan Arcon/)
    await assert.rejects(q("select tunjuk_captain($1::uuid, $2::uuid, 'x@y.z')", [ALSUT, R_AA]), /Rider tidak ditemukan/) // Arcon tak bisa jadi Captain
    // Gowa dipindah ke Arcon A (kini memegang 3 DS) → Arcon B kehilangan DS terakhirnya
    await q("select set_arcon($1::uuid, $2::uuid, ' Arcon-A@Test.Local ')", [GOWA, R_AA])
    assert.equal((await q('select count(*)::int n from ds where arcon_id = $1', [R_AA]))[0].n, 3)
    assert.equal((await q('select peran from riders where id = $1', [R_AB]))[0].peran, 'rider')
    assert.equal((await q('select email from riders where id = $1', [R_AA]))[0].email, 'arcon-a@test.local')
  })
  await as(AA, async () => {
    assert.ok((await nama()).includes('Rider Gowa')) // sekarang ikut memantau Gowa
  })
  await as(AB, async () => {
    assert.equal((await q('select * from riders')).length, 0) // bukan Arcon lagi, tak melihat apa pun
  })
})

test('Melepas Arcon dari semua DS menurunkannya jadi rider dan menutup aksesnya; anon tak bisa memanggil', async () => {
  await as(S, async () => {
    await q('select lepas_arcon($1::uuid)', [GOWA])
    await q('select lepas_arcon($1::uuid)', [GALAXY])
    assert.equal((await q('select peran from riders where id = $1', [R_AA]))[0].peran, 'arcon') // masih pegang Alsut
    await q('select lepas_arcon($1::uuid)', [ALSUT])
    assert.equal((await q('select peran from riders where id = $1', [R_AA]))[0].peran, 'rider')
  })
  await as(AA, async () => {
    assert.equal((await q('select * from riders')).length, 0)
    assert.equal((await q('select * from jadwal')).length, 0)
  })
  await as(null, async () => {
    await assert.rejects(q("select set_arcon($1::uuid, $2::uuid, 'x@y.z')", [GOWA, R_AA]), /permission denied/)
  })
})
