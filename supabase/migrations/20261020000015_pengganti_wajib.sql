-- Setiap rider yang tidak hadir (alpha, izin, sakit) wajib dipertanggungjawabkan penggantinya: pilih rider pengganti,
-- ATAU pilih "Tidak dapat pengganti" (tersimpan sebagai tanda tanpa_pengganti supaya laporan bisa membedakannya).
-- Sebelumnya: alpha boleh tanpa pengganti, izin dan sakit malah dilarang punya pengganti.
-- Aturan pengganti:
--  * harus rider lain di DS yang sama;
--  * tidak boleh rider yang hari itu dijadwalkan masuk (kecuali libur terkunci) dan tidak boleh yang sudah punya absensi lain di hari itu,
--    supaya absensi rider lain tidak tertimpa diam-diam;
--  * insentif pengganti boleh untuk alpha, izin, dan sakit (bukan tukar, karena itu pertukaran terencana).
-- Absensi lama yang tanpa pengganti tidak diubah.

alter table actual_harian add column tanpa_pengganti boolean not null default false;

drop function catat_actual(date, uuid, actual_status_t, uuid, text, boolean, int);
create function catat_actual(p_tanggal date, p_rider uuid, p_status actual_status_t,
                             p_backup uuid default null, p_penjelasan text default null,
                             p_potongan boolean default null, p_insentif int default 0,
                             p_tanpa_pengganti boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_ds uuid; v_me uuid := me(); v_ins int := coalesce(p_insentif, 0); v_tanpa boolean := coalesce(p_tanpa_pengganti, false);
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
  if p_status = 'hadir' and p_backup is not null then
    raise exception 'Rider pengganti hanya untuk rider yang tidak hadir';
  end if;
  if v_tanpa and p_status not in ('alpha', 'izin', 'sakit') then
    raise exception '"Tidak dapat pengganti" hanya untuk alpha, izin, atau sakit';
  end if;
  if v_ins < 0 then raise exception 'Nominal insentif tidak boleh negatif'; end if;
  if v_ins > 0 and not (p_status = 'pengganti' or (p_status in ('alpha', 'izin', 'sakit') and p_backup is not null)) then
    raise exception 'Insentif hanya untuk rider pengganti';
  end if;
  if p_status in ('alpha', 'izin', 'sakit') and p_potongan is null then
    raise exception 'Pilih dulu apakah rider ini kena potongan (Ya atau Tidak)';
  end if;
  if p_status in ('alpha', 'izin', 'sakit') then
    if p_backup is null and not v_tanpa then
      raise exception 'Pilih rider pengganti, atau pilih "Tidak dapat pengganti"';
    end if;
    if p_backup is not null and v_tanpa then
      raise exception 'Pilih rider pengganti atau "Tidak dapat pengganti", tidak keduanya';
    end if;
    if p_backup is not null then
      if exists (select 1 from jadwal j where j.tanggal = p_tanggal and j.rider_id = p_backup and j.shift <> 'off') then
        raise exception 'Rider pengganti tidak boleh yang sudah dijadwalkan masuk di hari itu';
      end if;
      if exists (select 1 from actual_harian a where a.tanggal = p_tanggal and a.rider_id = p_backup
                 and not (a.status = 'pengganti' and a.backup_untuk_id = p_rider)) then
        raise exception 'Rider pengganti sudah punya absensi di hari itu';
      end if;
    end if;
  end if;

  if p_status <> 'pengganti' then  -- bersihkan paket lama milik rider ini (termasuk insentif pengganti lama)
    delete from actual_harian where tanggal = p_tanggal and backup_untuk_id = p_rider and status = 'pengganti';
  end if;

  insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id, penjelasan, potongan, insentif, tanpa_pengganti, diinput_oleh)
  values (p_tanggal, p_rider, v_ds, p_status, case when p_status = 'pengganti' then p_backup end, p_penjelasan,
          case when p_status in ('alpha', 'izin', 'sakit') then p_potongan end,
          case when p_status = 'pengganti' then v_ins else 0 end, v_tanpa, v_me)
  on conflict (tanggal, rider_id) do update set
    status = excluded.status, backup_untuk_id = excluded.backup_untuk_id, penjelasan = excluded.penjelasan,
    potongan = excluded.potongan, insentif = excluded.insentif, tanpa_pengganti = excluded.tanpa_pengganti,
    diinput_oleh = v_me, jam_input = now(), ds_id = v_ds;

  if p_status in ('alpha', 'izin', 'sakit', 'tukar') and p_backup is not null then
    insert into actual_harian (tanggal, rider_id, ds_id, status, backup_untuk_id, potongan, insentif, diinput_oleh)
    values (p_tanggal, p_backup, v_ds, 'pengganti', p_rider, null, case when p_status = 'tukar' then 0 else v_ins end, v_me)
    on conflict (tanggal, rider_id) do update set
      status = 'pengganti', backup_untuk_id = p_rider, potongan = null, tanpa_pengganti = false,
      insentif = case when p_status = 'tukar' then 0 else v_ins end,
      diinput_oleh = v_me, jam_input = now(), ds_id = v_ds;
  end if;
end $$;
revoke execute on function catat_actual(date, uuid, actual_status_t, uuid, text, boolean, int, boolean) from public, anon;
grant execute on function catat_actual(date, uuid, actual_status_t, uuid, text, boolean, int, boolean) to authenticated;
