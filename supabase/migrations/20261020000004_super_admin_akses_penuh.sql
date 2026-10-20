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
