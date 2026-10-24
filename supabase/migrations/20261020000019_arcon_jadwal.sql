-- Arcon boleh menyusun jadwal (termasuk Susun otomatis) dan mengatur kebutuhan harian DS yang dipegangnya.
-- Sebelumnya hanya Captain DS itu dan Super-admin. Isi kedua fungsi sama seperti sebelumnya; yang berubah hanya pemeriksaan hak.

create or replace function simpan_jadwal(p_ds uuid, p_dari date, p_sampai date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  -- is not distinct from (bukan "="): pemanggil tanpa DS membuat my_ds() NULL, dan "NULL" pada not(...) akan meloloskan pemeriksaan
  if not (is_super() or p_ds is not distinct from my_ds() or (my_peran() = 'arcon' and p_ds = any(my_ds_ids()))) then
    raise exception 'Hanya Captain DS ini, Arcon yang memegangnya, atau Super-admin yang bisa menyusun jadwal';
  end if;
  if p_sampai < p_dari or p_sampai - p_dari > 62 then raise exception 'Rentang tanggal tidak valid (maks 63 hari)'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(tanggal date, rider_id uuid, shift shift_t)
    left join riders r on r.id = x.rider_id
    where x.tanggal not between p_dari and p_sampai or r.ds_id is distinct from p_ds
  ) then raise exception 'Ada baris di luar rentang atau rider bukan anggota DS ini'; end if;

  delete from jadwal where ds_id = p_ds and tanggal between p_dari and p_sampai;
  insert into jadwal (tanggal, rider_id, shift, ds_id)
    select x.tanggal, x.rider_id, x.shift, p_ds
    from jsonb_to_recordset(p_rows) as x(tanggal date, rider_id uuid, shift shift_t)
    on conflict (tanggal, rider_id) do update set shift = excluded.shift, ds_id = excluded.ds_id;
  get diagnostics v_n = row_count;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), 'ubah jadwal', (select nama from ds where id = p_ds) || ': ' || p_dari || ' s/d ' || p_sampai || ', ' || v_n || ' baris');
  return v_n;
end $$;

create or replace function simpan_kuota(p_ds uuid, p_dari date, p_sampai date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; v_ds ds%rowtype;
begin
  -- is not distinct from: pemanggil tanpa DS membuat my_ds() NULL, dan NULL pada not(...) akan meloloskan pemeriksaan
  if not (is_super() or p_ds is not distinct from my_ds() or (my_peran() = 'arcon' and p_ds = any(my_ds_ids()))) then
    raise exception 'Hanya Captain DS ini, Arcon yang memegangnya, atau Super-admin yang bisa mengatur kuota';
  end if;
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
