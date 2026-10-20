-- Tunjuk Captain (atomik) + laporan_ds ditambah kolom `terisi` (penyebut kepatuhan yang benar).

create function tunjuk_captain(p_ds uuid, p_rider uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'Email Captain wajib diisi'; end if;
  select captain_id into v_old from ds where id = p_ds;
  if not found then raise exception 'DS tidak ditemukan'; end if;
  if exists (select 1 from ds where captain_id = p_rider and id <> p_ds) then
    raise exception 'Rider ini sudah menjadi Captain DS lain';
  end if;
  update riders set peran = 'captain', email = p_email, ds_id = p_ds, status = 'aktif'
    where id = p_rider and peran in ('rider', 'captain');
  if not found then raise exception 'Rider tidak ditemukan (Super-admin tidak bisa dijadikan Captain)'; end if;
  update ds set captain_id = p_rider where id = p_ds;
  -- Captain lama yang tak memegang DS lain kembali jadi rider biasa
  if v_old is not null and v_old <> p_rider and not exists (select 1 from ds where captain_id = v_old) then
    update riders set peran = 'rider' where id = v_old and peran = 'captain';
  end if;
end $$;

drop function laporan_ds(date, date);
create function laporan_ds(p_dari date, p_sampai date)
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
  where is_super() or d.id = my_ds()
  order by d.nama
$$;

-- fungsi baru default-nya bisa dieksekusi anon di Supabase → cabut
revoke execute on function tunjuk_captain(uuid, uuid, text), laporan_ds(date, date) from public, anon;
grant execute on function tunjuk_captain(uuid, uuid, text), laporan_ds(date, date) to authenticated;
