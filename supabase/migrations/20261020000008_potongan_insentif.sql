-- Potongan (deduction) untuk rider yang tidak hadir, dan insentif untuk rider pengganti.
-- potongan: Ya/Tidak, hanya untuk alpha / izin / sakit (nominalnya tetap, dihitung di payroll nanti, jadi belum disimpan di sini).
-- insentif: nominal rupiah bebas (bervariasi), hanya untuk baris status 'pengganti'.
-- Belum ada data absensi yang dilaporkan, jadi kolom langsung dipasang tanpa pengisian data lama.
alter table actual_harian
  add column potongan boolean,
  add column insentif int not null default 0 check (insentif >= 0),
  add constraint actual_potongan_chk check (potongan is null or status in ('alpha', 'izin', 'sakit')),
  add constraint actual_insentif_chk check (insentif = 0 or status = 'pengganti');

-- catat_actual: tambah p_potongan dan p_insentif. Tanda tangan lama dihapus supaya tidak ada dua versi yang bentrok.
drop function catat_actual(date, uuid, actual_status_t, uuid, text);
create function catat_actual(p_tanggal date, p_rider uuid, p_status actual_status_t,
                             p_backup uuid default null, p_penjelasan text default null,
                             p_potongan boolean default null, p_insentif int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare v_ds uuid; v_me uuid := me(); v_ins int := coalesce(p_insentif, 0);
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
  if v_ins < 0 then raise exception 'Nominal insentif tidak boleh negatif'; end if;
  if v_ins > 0 and not (p_status = 'pengganti' or (p_status = 'alpha' and p_backup is not null)) then
    raise exception 'Insentif hanya untuk rider pengganti';
  end if;
  if p_status in ('alpha', 'izin', 'sakit') and p_potongan is null then
    raise exception 'Pilih dulu apakah rider ini kena potongan (Ya atau Tidak)';
  end if;

  if p_status <> 'pengganti' then  -- bersihkan paket lama milik rider ini (termasuk insentif pengganti lama)
    delete from actual_harian where tanggal = p_tanggal and backup_untuk_id = p_rider and status = 'pengganti';
  end if;

  insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id, penjelasan, potongan, insentif, diinput_oleh)
  values (p_tanggal, p_rider, v_ds, p_status, case when p_status = 'pengganti' then p_backup end, p_penjelasan,
          case when p_status in ('alpha', 'izin', 'sakit') then p_potongan end,
          case when p_status = 'pengganti' then v_ins else 0 end, v_me)
  on conflict (tanggal, rider_id) do update set
    status = excluded.status, backup_untuk_id = excluded.backup_untuk_id, penjelasan = excluded.penjelasan,
    potongan = excluded.potongan, insentif = excluded.insentif,
    diinput_oleh = v_me, jam_input = now(), ds_id = v_ds;

  if p_status in ('alpha', 'tukar') and p_backup is not null then
    insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id, potongan, insentif, diinput_oleh)
    values (p_tanggal, p_backup, v_ds, 'pengganti', p_rider, null, case when p_status = 'alpha' then v_ins else 0 end, v_me)
    on conflict (tanggal, rider_id) do update set
      status = 'pengganti', backup_untuk_id = p_rider, potongan = null,
      insentif = case when p_status = 'alpha' then v_ins else 0 end,
      diinput_oleh = v_me, jam_input = now(), ds_id = v_ds;
  end if;
end $$;
revoke execute on function catat_actual(date, uuid, actual_status_t, uuid, text, boolean, int) from public, anon;
grant execute on function catat_actual(date, uuid, actual_status_t, uuid, text, boolean, int) to authenticated;

-- laporan_rider: tambah jumlah hari kena potongan dan total insentif sebagai pengganti
drop function laporan_rider(date, date);
create function laporan_rider(p_dari date, p_sampai date)
returns table (rider_id uuid, kode_mtr text, nama text, ds_nama text, dijadwalkan int, hadir int,
               alpha int, izin int, sakit int, tukar int, pengganti int, belum_diisi int, potongan int, insentif bigint)
language sql stable as $$
  with x as (
    select coalesce(s.rider_id, a.rider_id) rid, coalesce(s.tanggal, a.tanggal) tgl,
           s.rider_id is not null as sched, a.status, a.potongan, a.insentif
    from (select rider_id, tanggal from jadwal where shift <> 'off' and tanggal between p_dari and p_sampai) s
    full join (select rider_id, tanggal, status, potongan, insentif from actual_harian where tanggal between p_dari and p_sampai) a
      on a.rider_id = s.rider_id and a.tanggal = s.tanggal
  )
  select r.id, r.kode_mtr, r.nama, d.nama,
    (count(*) filter (where x.sched))::int,
    (count(*) filter (where x.status = 'hadir'))::int,
    (count(*) filter (where x.status = 'alpha'))::int,
    (count(*) filter (where x.status = 'izin'))::int,
    (count(*) filter (where x.status = 'sakit'))::int,
    (count(*) filter (where x.status = 'tukar'))::int,
    (count(*) filter (where x.status = 'pengganti'))::int,
    (count(*) filter (where x.sched and x.status is null and x.tgl <= today_wib()))::int,
    (count(*) filter (where x.potongan))::int,
    (coalesce(sum(x.insentif) filter (where x.status = 'pengganti'), 0))::bigint
  from x join riders r on r.id = x.rid left join ds d on d.id = r.ds_id
  group by r.id, r.kode_mtr, r.nama, d.nama
  order by r.nama
$$;
revoke execute on function laporan_rider(date, date) from public, anon;
grant execute on function laporan_rider(date, date) to authenticated;

-- ringkasan_jadwal (0007) belum dicabut dari anon; tidak berbahaya (fungsi menolak non-admin) tapi dirapikan.
revoke execute on function ringkasan_jadwal(date, date) from public, anon;
grant execute on function ringkasan_jadwal(date, date) to authenticated;
