-- ===== 20261020000004_super_admin_akses_penuh.sql =====
-- Super-admin punya AKSES PENUH: semua yang bisa dilakukan Captain di satu DS, Super-admin bisa di DS mana pun
-- (menyusun jadwal, mengisi / mengoreksi / menghapus absensi) + membuka kunci periode mingguan.
-- Captain tetap hanya DS-nya sendiri; Arcon tetap hanya memantau. Setiap perubahan tercatat atas nama pelakunya
-- (diinput_oleh, log_aktivitas), jadi tetap bisa ditelusuri.

-- ───────── jadwal: Captain DS itu atau Super-admin ─────────
create or replace function simpan_jadwal(p_ds uuid, p_dari date, p_sampai date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  -- is not distinct from (bukan "="): pemanggil tanpa DS membuat my_ds() NULL, dan "NULL" pada not(...) akan meloloskan pemeriksaan
  if not (is_super() or p_ds is not distinct from my_ds()) then raise exception 'Hanya Captain DS ini atau Super-admin yang bisa menyusun jadwal'; end if;
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

-- ───────── absensi: Captain (DS-nya) atau Super-admin (DS tempat rider itu berada) ─────────
create or replace function catat_actual(p_tanggal date, p_rider uuid, p_status actual_status_t,
                                        p_backup uuid default null, p_penjelasan text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ds uuid; v_me uuid := me();
begin
  if is_super() then
    select ds_id into v_ds from riders where id = p_rider;
    if v_ds is null then raise exception 'Rider belum punya DS, masukkan ke DS dulu'; end if;
  else
    v_ds := my_ds();
    if v_ds is null then raise exception 'Hanya Captain atau Super-admin yang bisa mengisi actual'; end if;
  end if;
  if p_tanggal > today_wib() then raise exception 'Tidak bisa mengisi actual untuk tanggal mendatang'; end if;
  if not exists (select 1 from riders where id = p_rider and ds_id = v_ds) then
    raise exception 'Rider bukan anggota DS Anda';
  end if;
  if p_backup is not null and (p_backup = p_rider or not exists (select 1 from riders where id = p_backup and ds_id = v_ds)) then
    raise exception 'Backup/rekan harus rider lain di DS Anda';
  end if;
  if p_status = 'tukar' and p_backup is null then raise exception 'Tukar terencana wajib memilih rekan'; end if;
  if p_status in ('izin', 'sakit', 'hadir') and p_backup is not null then
    raise exception 'Backup hanya untuk alpha / tukar';
  end if;

  if p_status <> 'pengganti' then  -- bersihkan paket lama milik rider ini
    delete from actual_harian where tanggal = p_tanggal and backup_untuk_id = p_rider and status = 'pengganti';
  end if;

  insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id, penjelasan, diinput_oleh)
  values (p_tanggal, p_rider, v_ds, p_status, case when p_status = 'pengganti' then p_backup end, p_penjelasan, v_me)
  on conflict (tanggal, rider_id) do update set
    status = excluded.status, backup_untuk_id = excluded.backup_untuk_id, penjelasan = excluded.penjelasan,
    diinput_oleh = v_me, jam_input = now(), ds_id = v_ds;

  if p_status in ('alpha', 'tukar') and p_backup is not null then
    insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id, diinput_oleh)
    values (p_tanggal, p_backup, v_ds, 'pengganti', p_rider, v_me)
    on conflict (tanggal, rider_id) do update set
      status = 'pengganti', backup_untuk_id = p_rider, diinput_oleh = v_me, jam_input = now(), ds_id = v_ds;
  end if;
end $$;

create or replace function hapus_actual(p_tanggal date, p_rider uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ds uuid;
begin
  if is_super() then
    select ds_id into v_ds from riders where id = p_rider;
  else
    v_ds := my_ds();
  end if;
  if v_ds is null then raise exception 'Hanya Captain atau Super-admin'; end if;
  delete from actual_harian where tanggal = p_tanggal and ds_id = v_ds
    and (rider_id = p_rider or (backup_untuk_id = p_rider and status = 'pengganti'));
end $$;

-- ───────── Super-admin membuka kunci periode (untuk koreksi); tercatat di log ─────────
create function buka_kunci(p_ds uuid, p_minggu date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'Hanya Super-admin yang bisa membuka kunci periode'; end if;
  if not exists (select 1 from periode_kunci where ds_id = p_ds and minggu_mulai = p_minggu) then
    raise exception 'Periode ini tidak sedang dikunci';
  end if;
  delete from periode_kunci where ds_id = p_ds and minggu_mulai = p_minggu; -- hapus kunci dulu agar update di bawah tidak ditolak trigger
  update actual_harian set periode_terkunci = false where ds_id = p_ds and tanggal between p_minggu and p_minggu + 6;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), 'buka kunci', (select nama from ds where id = p_ds) || ': minggu ' || p_minggu);
end $$;

-- fungsi baru default-nya bisa dieksekusi anon di Supabase → cabut
revoke execute on function buka_kunci(uuid, date) from public, anon;
grant execute on function buka_kunci(uuid, date) to authenticated;

-- ===== 20261020000005_kuota_harian.sql =====
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

-- ===== 20261020000006_status_pengguna.sql =====
-- Status Arcon, Captain, dan Super-admin (aktif / nonaktif) hanya boleh diubah Super-admin.
-- Sebelumnya Captain boleh mengubah status SEMUA baris riders di DS-nya, termasuk baris Captain lain atau dirinya sendiri.
-- Penjagaan ada di trigger supaya berlaku untuk semua jalur (UI, API langsung). RPC SECURITY DEFINER tidak terkena (current_user bukan 'authenticated').
create or replace function riders_guard() returns trigger language plpgsql as $$
begin
  new.kode_mtr := nullif(upper(trim(new.kode_mtr)), '');
  new.email := nullif(lower(trim(new.email)), '');
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not is_super() then
    if (new.id, new.kode_mtr, new.nama, new.no_hp, new.ds_id, new.peran, new.email)
       is distinct from (old.id, old.kode_mtr, old.nama, old.no_hp, old.ds_id, old.peran, old.email) then
      raise exception 'Captain hanya boleh mengubah status rider';
    end if;
    if new.status is distinct from old.status and old.peran <> 'rider' then
      raise exception 'Hanya Super-admin yang boleh mengubah status Arcon dan Captain';
    end if;
  end if;
  return new;
end $$;

-- ===== 20261020000007_ringkasan_jadwal.sql =====
-- Daftar jadwal semua DS (satu baris per DS per minggu). Hanya Super-admin dan Arcon.
-- SECURITY INVOKER: RLS tabel jadwal tetap berlaku, jadi Super-admin melihat semua DS dan Arcon hanya DS yang dipegangnya.
create or replace function ringkasan_jadwal(p_dari date, p_sampai date)
returns table (ds_id uuid, ds_nama text, minggu date, rider int, shift int, libur_kunci int)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
begin
  if not (is_super() or my_peran() = 'arcon') then
    raise exception 'Hanya Super-admin dan Arcon yang bisa melihat daftar jadwal semua DS';
  end if;
  if p_sampai < p_dari or p_sampai - p_dari > 400 then
    raise exception 'Rentang tanggal tidak valid (maks 400 hari)';
  end if;
  return query
    select j.ds_id, d.nama, date_trunc('week', j.tanggal)::date,
           (count(distinct j.rider_id) filter (where j.shift <> 'off'))::int,
           (count(*) filter (where j.shift <> 'off'))::int,
           (count(*) filter (where j.shift = 'off'))::int
    from jadwal j join ds d on d.id = j.ds_id
    where j.tanggal between p_dari and p_sampai
    group by j.ds_id, d.nama, date_trunc('week', j.tanggal)
    order by 3 desc, 2;
end $$;

