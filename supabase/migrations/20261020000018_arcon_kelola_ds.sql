-- Arcon boleh mengelola DS yang dipegangnya, terbatas pada dua hal:
--  1. mengatur kebutuhan rider per shift (kuota_pagi dan kuota_siang);
--  2. menunjuk atau mengganti Captain, hanya dari rider yang sudah ada di DS itu.
-- Membuat DS, mengganti nama DS, memilih Arcon, dan menunjuk Captain dari DS lain tetap hanya Super-admin.

-- 1. Kuota: Arcon boleh mengubah baris DS yang dipegangnya, tetapi trigger memastikan yang berubah HANYA kuota.
create policy ds_update_arcon on ds for update to authenticated
  using (my_peran() = 'arcon' and id = any(my_ds_ids()))
  with check (my_peran() = 'arcon' and id = any(my_ds_ids()));

create function ds_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not is_super() then
    if (new.id, new.nama, new.captain_id, new.arcon_id, new.group_wa_id)
       is distinct from (old.id, old.nama, old.captain_id, old.arcon_id, old.group_wa_id) then
      raise exception 'Arcon hanya boleh mengubah kebutuhan rider (kuota) DS';
    end if;
  end if;
  return new;
end $$;
create trigger ds_guard_t before update on ds for each row execute function ds_guard();

-- 2. Tunjuk Captain: Super-admin untuk DS mana pun; Arcon hanya untuk DS yang dipegang dan hanya dari rider DS itu sendiri.
create or replace function tunjuk_captain(p_ds uuid, p_rider uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if not (is_super() or (my_peran() = 'arcon' and p_ds = any(my_ds_ids()))) then
    raise exception 'Hanya Super-admin, atau Arcon yang memegang DS ini';
  end if;
  if not is_super() and not exists (select 1 from riders where id = p_rider and ds_id = p_ds) then
    raise exception 'Arcon hanya bisa memilih Captain dari rider DS itu sendiri';
  end if;
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
