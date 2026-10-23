-- Bahan laporan fulfillment rate per hari: seberapa banyak kebutuhan client yang benar-benar terpenuhi di lapangan.
-- Satu baris per DS per tanggal (dari p_dari sampai paling jauh hari ini). Angka persennya dihitung di aplikasi (src/fulfillment.ts).
--
-- terpenuhi_* = rider yang bekerja pada shift itu: status hadir, tukar (rider yang bertukar bekerja di shift rekannya),
--   dan pengganti. Shift pengganti = shift rider yang digantikannya; pengganti yang tidak menggantikan siapa pun
--   (rider tambahan yang tidak dijadwalkan) masuk terpenuhi_lain dan menutup kekurangan shift mana pun.
-- kebutuhan_* = kebutuhan client hari itu (kuota_harian bila diubah, selain itu kuota bawaan DS). Cadangan tidak dihitung.
-- lapor_* = sudah ada rider shift itu yang diabsen. siang_jatuh_tempo: shift siang hari ini baru dianggap selesai setelah pukul 22:00 WIB.
-- SECURITY INVOKER: RLS tetap berlaku, tiap peran hanya melihat DS yang boleh dilihatnya.

create function laporan_fulfillment(p_dari date, p_sampai date)
returns table (tanggal date, ds_id uuid, ds_nama text, kebutuhan_pagi int, kebutuhan_siang int,
               terpenuhi_pagi int, terpenuhi_siang int, terpenuhi_lain int, lapor_pagi boolean, lapor_siang boolean, siang_jatuh_tempo boolean)
language sql stable as $$
  select g.tgl::date, d.id, d.nama,
    coalesce(k.kuota_pagi, d.kuota_pagi), coalesce(k.kuota_siang, d.kuota_siang),
    (select count(*) from actual_harian a
       join jadwal j on j.tanggal = a.tanggal and j.rider_id = case when a.status = 'pengganti' then a.backup_untuk_id else a.rider_id end
       where a.ds_id = d.id and a.tanggal = g.tgl::date and a.status in ('hadir', 'tukar', 'pengganti') and j.shift = 'pagi')::int,
    (select count(*) from actual_harian a
       join jadwal j on j.tanggal = a.tanggal and j.rider_id = case when a.status = 'pengganti' then a.backup_untuk_id else a.rider_id end
       where a.ds_id = d.id and a.tanggal = g.tgl::date and a.status in ('hadir', 'tukar', 'pengganti') and j.shift = 'siang')::int,
    (select count(*) from actual_harian a
       where a.ds_id = d.id and a.tanggal = g.tgl::date and a.status in ('hadir', 'tukar', 'pengganti')
         and not exists (select 1 from jadwal j where j.tanggal = a.tanggal and j.shift in ('pagi', 'siang')
                         and j.rider_id = case when a.status = 'pengganti' then a.backup_untuk_id else a.rider_id end))::int,
    exists (select 1 from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id
            where j.ds_id = d.id and j.tanggal = g.tgl::date and j.shift = 'pagi'),
    exists (select 1 from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id
            where j.ds_id = d.id and j.tanggal = g.tgl::date and j.shift = 'siang'),
    (g.tgl::date < today_wib() or (now() at time zone 'Asia/Jakarta')::time >= time '22:00')
  from ds d
  cross join generate_series(p_dari::timestamp, least(p_sampai, today_wib())::timestamp, interval '1 day') g(tgl)
  left join kuota_harian k on k.ds_id = d.id and k.tanggal = g.tgl::date
  where is_super() or d.id = any(my_ds_ids())
  order by g.tgl, d.nama
$$;

revoke execute on function laporan_fulfillment(date, date) from public, anon;
grant execute on function laporan_fulfillment(date, date) to authenticated;
