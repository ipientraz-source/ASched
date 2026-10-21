-- Pengajuan servis massal dan servis mendesak.
-- 1) Arcon / Super-admin mencentang beberapa motor lalu mengajukan servis dengan beberapa penggantian part sekaligus.
-- 2) Captain tidak mengajukan rutin; dia hanya mengajukan servis MENDESAK untuk satu motor di DS-nya.
-- 3) Catatan servis menyimpan daftar part yang diganti.

alter table permintaan_servis
  add column pekerjaan text[] not null default '{}' check (cardinality(pekerjaan) <= 20),
  add column urgent boolean not null default false;
alter table servis_motor
  add column pekerjaan text[] not null default '{}' check (cardinality(pekerjaan) <= 20);

-- Pengajuan: cakupan bisa semua motor (seperti sebelumnya), satu DS, atau motor yang dipilih (p_motor); plus daftar part (p_pekerjaan)
drop function buat_permintaan_servis(text, text, date, text, uuid);
create function buat_permintaan_servis(p_judul text, p_jenis text, p_tenggat date, p_catatan text default null, p_ds uuid default null,
                                       p_motor uuid[] default null, p_pekerjaan text[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int; v_pilih int;
begin
  if not (is_super() or my_peran() = 'arcon') then raise exception 'Hanya Super-admin atau Arcon yang bisa membuat pengajuan servis'; end if;
  if length(trim(coalesce(p_judul, ''))) = 0 then raise exception 'Judul pengajuan wajib diisi'; end if;
  if length(trim(coalesce(p_jenis, ''))) = 0 then raise exception 'Jenis servis wajib diisi'; end if;
  if p_tenggat is not null and p_tenggat < today_wib() then raise exception 'Tenggat tidak boleh di masa lalu'; end if;
  if p_ds is not null and not is_super() and not (p_ds = any(my_ds_ids())) then raise exception 'DS tersebut bukan milik Anda'; end if;
  if p_motor is not null then
    v_pilih := cardinality(p_motor);
    if v_pilih = 0 then raise exception 'Pilih minimal satu motor'; end if;
    if (select count(*) from motor m where m.id = any(p_motor) and (is_super() or m.ds_id = any(my_ds_ids()))) <> (select count(distinct x) from unnest(p_motor) x) then
      raise exception 'Ada motor yang tidak ditemukan atau bukan milik Anda';
    end if;
  end if;
  insert into permintaan_servis (judul, jenis, tenggat, catatan, pekerjaan, dibuat_oleh)
    values (trim(p_judul), trim(p_jenis), p_tenggat, nullif(trim(coalesce(p_catatan, '')), ''), coalesce(p_pekerjaan, '{}'), me()) returning id into v_id;
  insert into permintaan_servis_item (permintaan_id, motor_id)
    select v_id, m.id from motor m
    where case
      when p_motor is not null then m.id = any(p_motor)
      when p_ds is not null then m.ds_id = p_ds
      else (is_super() or m.ds_id = any(my_ds_ids()))
    end;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Tidak ada motor di cakupan yang dipilih'; end if;
  insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'pengajuan servis', trim(p_judul) || ': ' || v_n || ' motor');
  return v_id;
end $$;

-- Servis mendesak: dipakai Captain (motor DS-nya), Arcon, dan Super-admin. Masuk daftar menunggu servis dengan tanda urgent.
create function ajukan_servis_mendesak(p_motor uuid, p_alasan text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_kode text; v_ds uuid;
begin
  select kode_motor, ds_id into v_kode, v_ds from motor where id = p_motor;
  if not found then raise exception 'Motor tidak ditemukan'; end if;
  if not (is_super() or (my_peran() = 'arcon' and v_ds = any(my_ds_ids())) or (my_peran() = 'captain' and v_ds is not distinct from my_ds())) then
    raise exception 'Anda tidak berwenang mengajukan servis untuk motor ini';
  end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan servis mendesak wajib diisi'; end if;
  if exists (select 1 from permintaan_servis_item i join permintaan_servis p on p.id = i.permintaan_id
             where i.motor_id = p_motor and p.urgent and i.status in ('diminta', 'dijadwalkan')) then
    raise exception 'Motor ini sudah punya pengajuan servis mendesak yang belum selesai';
  end if;
  insert into permintaan_servis (judul, jenis, tenggat, catatan, urgent, dibuat_oleh)
    values ('Servis mendesak ' || v_kode, 'Servis rutin', today_wib(), trim(p_alasan), true, me()) returning id into v_id;
  insert into permintaan_servis_item (permintaan_id, motor_id) values (v_id, p_motor);
  insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'servis mendesak', v_kode || ': ' || trim(p_alasan));
  return v_id;
end $$;

revoke execute on function buat_permintaan_servis(text, text, date, text, uuid, uuid[], text[]), ajukan_servis_mendesak(uuid, text) from public, anon;
grant execute on function buat_permintaan_servis(text, text, date, text, uuid, uuid[], text[]), ajukan_servis_mendesak(uuid, text) to authenticated;
