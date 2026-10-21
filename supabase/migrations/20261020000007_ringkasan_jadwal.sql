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
