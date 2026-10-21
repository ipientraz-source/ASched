-- Arcon bukan rider: orang dari tim yang ditunjuk khusus. Dibuat sebagai pengguna baru (nama + email, peran 'arcon'),
-- bukan dengan mengubah rider. Di tiap DS, Super-admin hanya memilih salah satu Arcon yang sudah ada.
-- set_arcon (mengubah rider jadi Arcon) diganti pilih_arcon. lepas_arcon hanya mencopot dari DS, orangnya tetap Arcon.
drop function set_arcon(uuid, uuid, text);

create function pilih_arcon(p_ds uuid, p_arcon uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  if not exists (select 1 from ds where id = p_ds) then raise exception 'DS tidak ditemukan'; end if;
  if not exists (select 1 from riders where id = p_arcon and peran = 'arcon' and status = 'aktif') then
    raise exception 'Arcon tidak ditemukan atau nonaktif. Tambahkan Arcon dulu di halaman Kelola DS & Captain';
  end if;
  update ds set arcon_id = p_arcon where id = p_ds;
end $$;

create or replace function lepas_arcon(p_ds uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  update ds set arcon_id = null where id = p_ds;
end $$;

revoke execute on function pilih_arcon(uuid, uuid), lepas_arcon(uuid) from public, anon;
grant execute on function pilih_arcon(uuid, uuid), lepas_arcon(uuid) to authenticated;
