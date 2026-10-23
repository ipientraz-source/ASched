// Uji fulfillment rate: hitungan murni (src/fulfillment.ts) dan bahan datanya di Postgres (laporan_fulfillment, PGlite).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { hitungDsHari, persen, ringkasFulfillment, tingkatFulfillment } from '../src/fulfillment.ts'

const baris = (o = {}) => ({
  tanggal: '2026-10-20', ds_id: 'd1', ds_nama: 'DS A', kebutuhan_pagi: 3, kebutuhan_siang: 2,
  terpenuhi_pagi: 3, terpenuhi_siang: 2, terpenuhi_lain: 0, lapor_pagi: true, lapor_siang: true, siang_jatuh_tempo: true, ...o,
})

test('contoh dari penjelasan: pagi 3/3 setelah pengganti, siang 1/2 → (3 + 1) / 5 = 80%', () => {
  const h = hitungDsHari(baris({ terpenuhi_pagi: 3, terpenuhi_siang: 1 }))
  assert.equal(h.kebutuhan, 5)
  assert.equal(h.terpenuhi, 4)
  assert.equal(h.rate, 0.8)
  assert.equal(tingkatFulfillment(h.rate), 'perhatian')
  assert.equal(persen(h.rate), '80%')
})

test('kelebihan rider tidak menaikkan rate (maksimal 100% per shift) dan tidak menutupi shift lain', () => {
  const h = hitungDsHari(baris({ terpenuhi_pagi: 5, terpenuhi_siang: 1 })) // pagi kelebihan 2, siang kurang 1
  assert.equal(h.terpenuhi, 4) // 3 + 1, bukan 6
  assert.equal(h.kelebihan, 2)
  assert.equal(h.rate, 0.8)
})

test('pengganti yang tidak menggantikan siapa pun (lain) menutup kekurangan shift mana pun, sisanya jadi kelebihan', () => {
  const h = hitungDsHari(baris({ terpenuhi_pagi: 2, terpenuhi_siang: 2, terpenuhi_lain: 2 }))
  assert.equal(h.terpenuhi, 5) // kurang pagi 1 ditutup lain 1
  assert.equal(h.kelebihan, 1)
  assert.equal(h.rate, 1)
})

test('shift yang belum dilaporkan bukan 0%: tidak dihitung, ditandai belum dilaporkan', () => {
  const h = hitungDsHari(baris({ lapor_siang: false, terpenuhi_siang: 0 }))
  assert.equal(h.kebutuhan, 3) // hanya pagi
  assert.equal(h.rate, 1)
  assert.deepEqual(h.belumLapor, ['siang'])
  // hari ini sebelum 22:00: siang belum jatuh tempo, tidak ditandai
  assert.deepEqual(hitungDsHari(baris({ lapor_siang: false, siang_jatuh_tempo: false })).belumLapor, [])
  // tidak ada satu shift pun yang dilaporkan: rate kosong, bukan 0%
  const kosong = hitungDsHari(baris({ lapor_pagi: false, lapor_siang: false }))
  assert.equal(kosong.rate, null)
  assert.equal(tingkatFulfillment(kosong.rate), 'kosong')
  assert.equal(persen(kosong.rate), '–')
  // kebutuhan 0 pada suatu shift bukan "belum dilaporkan"
  assert.deepEqual(hitungDsHari(baris({ kebutuhan_siang: 0, lapor_siang: false })).belumLapor, [])
})

test('ringkasan: per hari menjumlahkan semua DS, per DS menjumlahkan periode, total periode', () => {
  const rows = [
    baris({ tanggal: '2026-10-20', ds_id: 'd1', ds_nama: 'DS A' }), // 5/5
    baris({ tanggal: '2026-10-20', ds_id: 'd2', ds_nama: 'DS B', kebutuhan_pagi: 2, kebutuhan_siang: 2, terpenuhi_pagi: 1, terpenuhi_siang: 2 }), // 3/4
    baris({ tanggal: '2026-10-21', ds_id: 'd1', ds_nama: 'DS A', terpenuhi_pagi: 2, terpenuhi_siang: 2 }), // 4/5
    baris({ tanggal: '2026-10-21', ds_id: 'd2', ds_nama: 'DS B', lapor_pagi: false, lapor_siang: false, terpenuhi_pagi: 0, terpenuhi_siang: 0 }), // belum lapor
  ]
  const r = ringkasFulfillment(rows)
  assert.deepEqual(r.harian.map((h) => [h.tanggal, h.kebutuhan, h.terpenuhi]), [['2026-10-20', 9, 8], ['2026-10-21', 5, 4]])
  assert.deepEqual(r.harian[1].belumDs, ['DS B (pagi dan siang)'])
  assert.deepEqual(r.perDs.map((d) => [d.ds_nama, d.kebutuhan, d.terpenuhi, d.hariBelumLapor]), [['DS A', 10, 9, 0], ['DS B', 4, 3, 1]])
  assert.equal(r.total.kebutuhan, 14)
  assert.equal(r.total.terpenuhi, 12)
  assert.equal(persen(r.total.rate), '86%')
})

// ── bahan datanya di database ──
const db = new PGlite()
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const GALAXY = id(101), ALSUT = id(102)
const [P1, P2, S1, S2, EXTRA] = [id(21), id(22), id(23), id(24), id(25)]
const q = async (sql, p) => (await db.query(sql, p)).rows

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
    insert into ds (id, nama, kuota_pagi, kuota_siang) values ('${GALAXY}', 'Galaxy', 2, 1), ('${ALSUT}', 'Alam Sutera', 1, 1);
    insert into riders (id, kode_mtr, nama, ds_id, peran, email, status) values
      ('${id(1)}', null, 'Super', null, 'super_admin', 'super@test.local', 'aktif'),
      ('${P1}', 'M1', 'Pagi Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${P2}', 'M2', 'Pagi Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${S1}', 'M3', 'Siang Satu', '${GALAXY}', 'rider', null, 'aktif'), ('${S2}', 'M4', 'Siang Dua', '${GALAXY}', 'rider', null, 'aktif'),
      ('${EXTRA}', 'M5', 'Tambahan', '${GALAXY}', 'rider', null, 'aktif');
    -- kemarin: kebutuhan Galaxy diubah jadi 2 pagi + 2 siang; P1 hadir, P2 alpha digantikan EXTRA, S1 hadir, S2 sakit tanpa pengganti
    insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang) values ('${GALAXY}', today_wib() - 1, 2, 2);
    insert into jadwal (tanggal, rider_id, shift, ds_id) values
      (today_wib() - 1, '${P1}', 'pagi', '${GALAXY}'), (today_wib() - 1, '${P2}', 'pagi', '${GALAXY}'),
      (today_wib() - 1, '${S1}', 'siang', '${GALAXY}'), (today_wib() - 1, '${S2}', 'siang', '${GALAXY}');
    insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id, potongan) values
      (today_wib() - 1, '${P1}', '${GALAXY}', 'hadir', null, null), (today_wib() - 1, '${P2}', '${GALAXY}', 'alpha', null, true),
      (today_wib() - 1, '${EXTRA}', '${GALAXY}', 'pengganti', '${P2}', null),
      (today_wib() - 1, '${S1}', '${GALAXY}', 'hadir', null, null), (today_wib() - 1, '${S2}', '${GALAXY}', 'sakit', null, false);`)
})
after(() => db.close())

test('laporan_fulfillment: kebutuhan dari kuota harian, pengganti dihitung di shift rider yang digantikan, sakit tanpa pengganti tidak terpenuhi', async () => {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"email":"super@test.local"}', false); set role authenticated`)
  const rows = await q(`select * from laporan_fulfillment(today_wib() - 1, today_wib() - 1)`)
  await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`)
  assert.equal(rows.length, 2) // dua DS pada satu tanggal
  const g = rows.find((r) => r.ds_nama === 'Galaxy')
  assert.deepEqual([g.kebutuhan_pagi, g.kebutuhan_siang, g.terpenuhi_pagi, g.terpenuhi_siang, g.terpenuhi_lain], [2, 2, 2, 1, 0]) // pagi: P1 + pengganti; siang: S1 saja
  assert.deepEqual([g.lapor_pagi, g.lapor_siang, g.siang_jatuh_tempo], [true, true, true])
  const a = rows.find((r) => r.ds_nama === 'Alam Sutera')
  assert.deepEqual([a.kebutuhan_pagi, a.kebutuhan_siang, a.lapor_pagi, a.lapor_siang], [1, 1, false, false]) // kuota bawaan, belum ada laporan
  const h = hitungDsHari({ ...g, tanggal: String(g.tanggal) })
  assert.equal(h.rate, 0.75) // 3 dari 4
})
