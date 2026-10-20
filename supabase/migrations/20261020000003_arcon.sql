-- Arcon: atasan Captain. Satu Arcon bisa memegang beberapa DS (ds.arcon_id tidak unik);
-- satu DS punya satu Captain dan paling banyak satu Arcon.
-- Hak Arcon (versi awal): MEMANTAU DS yang dipegang (rider, jadwal, absensi, laporan) + mengunci absensi mingguan.
-- Menyusun jadwal dan mengisi absensi tetap hak Captain (RPC-nya memeriksa my_ds()).

alter table ds add column arcon_id uuid references riders(id) on delete set null;
create index on ds (arcon_id);

-- Arcon ikut dihitung sebagai admin (boleh membaca daftar DS untuk dropdown, cari rider, dst.)
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_peran() in ('captain', 'arcon', 'super_admin'), false)
$$;

-- Semua DS yang dipegang pemanggil: Captain → DS-nya; Arcon → semua DS di bawahnya
create function my_ds_ids() returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}'::uuid[]) from ds
  where (my_peran() = 'captain' and captain_id = me()) or (my_peran() = 'arcon' and arcon_id = me())
$$;

-- ───────── kebijakan baca: Captain dan Arcon dibatasi ke DS yang dipegang ─────────
drop policy riders_read on riders;
create policy riders_read on riders for select to authenticated
  using (is_super() or (my_peran() in ('captain', 'arcon') and (ds_id = any(my_ds_ids()) or id = me())));

drop policy jadwal_read on jadwal;
create policy jadwal_read on jadwal for select to authenticated
  using (is_super() or (my_peran() in ('captain', 'arcon') and ds_id = any(my_ds_ids())) or rider_id = me());

drop policy actual_read on actual_harian;
create policy actual_read on actual_harian for select to authenticated
  using (is_super() or (my_peran() in ('captain', 'arcon') and ds_id = any(my_ds_ids())));

drop policy kunci_read on periode_kunci;
create policy kunci_read on periode_kunci for select to authenticated
  using (is_super() or ds_id = any(my_ds_ids()));

drop policy pindah_read on perpindahan_rider;
create policy pindah_read on perpindahan_rider for select to authenticated
  using (is_super() or dari_ds = any(my_ds_ids()) or ke_ds = any(my_ds_ids()));

-- Arcon melihat jejak aktivitas Captain di DS-nya
drop policy log_read on log_aktivitas;
create policy log_read on log_aktivitas for select to authenticated
  using (is_super() or captain_id = me()
         or captain_id in (select captain_id from ds where id = any(my_ds_ids()) and captain_id is not null));

-- ───────── laporan & kunci periode: mengenal Arcon ─────────
create or replace function laporan_ds(p_dari date, p_sampai date)
returns table (ds_id uuid, ds_nama text, dijadwalkan int, terisi int, patuh int, alpha int, tukar int, pengganti int,
               belum_diisi int, hari_belum_isi int, terakhir_input timestamptz)
language sql stable as $$
  select d.id, d.nama,
    (select count(*) from jadwal j where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai)::int,
    (select count(*) from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id
       where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai)::int,
    (select count(*) from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id
       where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai and a.status = 'hadir')::int,
    (select count(*) from actual_harian a where a.ds_id = d.id and a.tanggal between p_dari and p_sampai and a.status = 'alpha')::int,
    (select count(*) from actual_harian a where a.ds_id = d.id and a.tanggal between p_dari and p_sampai and a.status = 'tukar')::int,
    (select count(*) from actual_harian a where a.ds_id = d.id and a.tanggal between p_dari and p_sampai and a.status = 'pengganti')::int,
    (select count(*) from jadwal j where j.ds_id = d.id and j.shift <> 'off'
       and j.tanggal between p_dari and least(p_sampai, today_wib())
       and not exists (select 1 from actual_harian a where a.tanggal = j.tanggal and a.rider_id = j.rider_id))::int,
    (select count(distinct j.tanggal) from jadwal j where j.ds_id = d.id and j.shift <> 'off'
       and j.tanggal between p_dari and least(p_sampai, today_wib())
       and not exists (select 1 from actual_harian a where a.tanggal = j.tanggal and a.ds_id = d.id))::int,
    (select max(a.jam_input) from actual_harian a where a.ds_id = d.id)
  from ds d
  where is_super() or d.id = any(my_ds_ids())
  order by d.nama
$$;

create or replace function kunci_periode(p_ds uuid, p_minggu date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_super() or p_ds = any(my_ds_ids())) then raise exception 'Tidak berwenang'; end if;
  if p_minggu <> date_trunc('week', p_minggu)::date then raise exception 'Tanggal harus hari Senin'; end if;
  if p_minggu + 6 >= today_wib() then raise exception 'Minggu ini belum selesai, belum bisa dikunci'; end if;
  update actual_harian set periode_terkunci = true where ds_id = p_ds and tanggal between p_minggu and p_minggu + 6;
  insert into periode_kunci (ds_id, minggu_mulai, dikunci_oleh) values (p_ds, p_minggu, me())
    on conflict do nothing;
end $$;

-- ───────── Super-admin menunjuk / melepas Arcon ─────────
-- Satu rider bisa dipasang di beberapa DS (panggil per DS). Captain tidak bisa merangkap Arcon.
create function set_arcon(p_ds uuid, p_rider uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'Email Arcon wajib diisi'; end if;
  select arcon_id into v_old from ds where id = p_ds;
  if not found then raise exception 'DS tidak ditemukan'; end if;
  if exists (select 1 from ds where captain_id = p_rider) then
    raise exception 'Rider ini adalah Captain. Satu orang tidak bisa merangkap Captain dan Arcon';
  end if;
  update riders set peran = 'arcon', email = p_email, status = 'aktif'
    where id = p_rider and peran in ('rider', 'arcon');
  if not found then raise exception 'Rider tidak ditemukan (Captain dan Super-admin tidak bisa dijadikan Arcon)'; end if;
  update ds set arcon_id = p_rider where id = p_ds;
  -- Arcon lama yang tak memegang DS lain kembali jadi rider biasa
  if v_old is not null and v_old <> p_rider and not exists (select 1 from ds where arcon_id = v_old) then
    update riders set peran = 'rider' where id = v_old and peran = 'arcon';
  end if;
end $$;

create function lepas_arcon(p_ds uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  select arcon_id into v_old from ds where id = p_ds;
  update ds set arcon_id = null where id = p_ds;
  if v_old is not null and not exists (select 1 from ds where arcon_id = v_old) then
    update riders set peran = 'rider' where id = v_old and peran = 'arcon';
  end if;
end $$;

-- fungsi baru default-nya bisa dieksekusi anon di Supabase → cabut
revoke execute on function my_ds_ids(), set_arcon(uuid, uuid, text), lepas_arcon(uuid) from public, anon;
grant execute on function my_ds_ids(), set_arcon(uuid, uuid, text), lepas_arcon(uuid) to authenticated;
