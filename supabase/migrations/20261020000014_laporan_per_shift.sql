-- Laporan absensi per shift: Captain boleh melaporkan shift pagi lebih dulu tanpa menunggu hari selesai.
-- laporan_ds menambah dua kolom: berapa hari shift pagi dan shift siang yang BELUM diisi sama sekali (satu rider pun belum).
-- Pagi dihitung sampai hari ini; siang hari ini baru dihitung setelah shift selesai (pukul 22:00 WIB), sebelum itu sampai kemarin.
-- Kolom lama (hari_belum_isi dan lainnya) tidak berubah.

drop function laporan_ds(date, date);
create function laporan_ds(p_dari date, p_sampai date)
returns table (ds_id uuid, ds_nama text, dijadwalkan int, terisi int, patuh int, alpha int, tukar int, pengganti int,
               belum_diisi int, hari_belum_isi int, terakhir_input timestamptz, pagi_belum_isi int, siang_belum_isi int)
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
    (select max(a.jam_input) from actual_harian a where a.ds_id = d.id),
    (select count(distinct j.tanggal) from jadwal j where j.ds_id = d.id and j.shift = 'pagi'
       and j.tanggal between p_dari and least(p_sampai, today_wib())
       and not exists (select 1 from jadwal j2 join actual_harian a on a.tanggal = j2.tanggal and a.rider_id = j2.rider_id
                       where j2.ds_id = d.id and j2.tanggal = j.tanggal and j2.shift = 'pagi'))::int,
    (select count(distinct j.tanggal) from jadwal j where j.ds_id = d.id and j.shift = 'siang'
       and j.tanggal between p_dari and least(p_sampai, case when (now() at time zone 'Asia/Jakarta')::time >= time '22:00' then today_wib() else today_wib() - 1 end)
       and not exists (select 1 from jadwal j2 join actual_harian a on a.tanggal = j2.tanggal and a.rider_id = j2.rider_id
                       where j2.ds_id = d.id and j2.tanggal = j.tanggal and j2.shift = 'siang'))::int
  from ds d
  where is_super() or d.id = any(my_ds_ids())
  order by d.nama
$$;

revoke execute on function laporan_ds(date, date) from public, anon;
grant execute on function laporan_ds(date, date) to authenticated;
