-- Kebutuhan rider per hari mengikuti permintaan client: kuota boleh beda tiap tanggal.
-- Baris di sini MENIMPA kuota bawaan DS (ds.kuota_pagi / ds.kuota_siang) pada tanggal itu; tanggal tanpa baris memakai bawaan DS.
-- `cadangan` = rider tambahan yang sengaja dijadwalkan di atas kebutuhan client (berdasarkan pola absen), tidak mengubah kebutuhan client.
create table kuota_harian (
  ds_id uuid not null references ds(id) on delete cascade,
  tanggal date not null,
  kuota_pagi int not null check (kuota_pagi between 0 and 500),
  kuota_siang int not null check (kuota_siang between 0 and 500),
  cadangan int not null default 0 check (cadangan between 0 and 100),
  primary key (ds_id, tanggal)
);
alter table kuota_harian enable row level security;
revoke all on kuota_harian from anon;
-- baca: Super-admin semua DS; Captain / Arcon DS yang dipegang. Tulis hanya lewat simpan_kuota.
create policy kuota_read on kuota_harian for select to authenticated using (is_super() or ds_id = any(my_ds_ids()));

-- Simpan kuota harian untuk rentang tanggal (menimpa rentang itu). Hanya hari yang berbeda dari bawaan DS, atau yang punya
-- cadangan, yang disimpan. p_rows: [{"tanggal":"2026-10-31","pagi":5,"siang":3,"cadangan":1}]
create function simpan_kuota(p_ds uuid, p_dari date, p_sampai date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; v_ds ds%rowtype;
begin
  -- is not distinct from: pemanggil tanpa DS membuat my_ds() NULL, dan NULL pada not(...) akan meloloskan pemeriksaan
  if not (is_super() or p_ds is not distinct from my_ds()) then raise exception 'Hanya Captain DS ini atau Super-admin yang bisa mengatur kuota'; end if;
  if p_sampai < p_dari or p_sampai - p_dari > 62 then raise exception 'Rentang tanggal tidak valid (maks 63 hari)'; end if;
  select * into v_ds from ds where id = p_ds;
  if not found then raise exception 'DS tidak ditemukan'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(tanggal date, pagi int, siang int, cadangan int)
    where x.tanggal not between p_dari and p_sampai or x.pagi is null or x.siang is null or x.pagi < 0 or x.siang < 0 or coalesce(x.cadangan, 0) < 0
  ) then raise exception 'Isian kuota tidak valid (di luar rentang tanggal atau bernilai negatif)'; end if;

  delete from kuota_harian where ds_id = p_ds and tanggal between p_dari and p_sampai;
  insert into kuota_harian (ds_id, tanggal, kuota_pagi, kuota_siang, cadangan)
    select p_ds, x.tanggal, x.pagi, x.siang, coalesce(x.cadangan, 0)
    from jsonb_to_recordset(p_rows) as x(tanggal date, pagi int, siang int, cadangan int)
    where x.pagi <> v_ds.kuota_pagi or x.siang <> v_ds.kuota_siang or coalesce(x.cadangan, 0) > 0
    on conflict (ds_id, tanggal) do update set kuota_pagi = excluded.kuota_pagi, kuota_siang = excluded.kuota_siang, cadangan = excluded.cadangan;
  get diagnostics v_n = row_count;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), 'ubah kuota', v_ds.nama || ': ' || p_dari || ' s/d ' || p_sampai || ', ' || v_n || ' hari berbeda dari bawaan');
  return v_n;
end $$;

-- fungsi baru default-nya bisa dieksekusi anon di Supabase → cabut
revoke execute on function simpan_kuota(uuid, date, date, jsonb) from public, anon;
grant execute on function simpan_kuota(uuid, date, date, jsonb) to authenticated;
