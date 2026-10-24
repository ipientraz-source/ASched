-- Arcon boleh menonaktifkan (atau mengaktifkan kembali) rider di DS yang dipegangnya, mis. rider yang sudah tidak jalan.
-- Sebelumnya hanya Super-admin dan Captain DS itu yang boleh.
-- Batasnya tetap diketat oleh trigger riders_guard: selain Super-admin, yang boleh berubah HANYA kolom status, dan status Arcon
-- dan Captain tetap hanya bisa diubah Super-admin. Jadi Arcon tidak bisa memindahkan rider, mengganti nama, atau menyentuh Captain.

drop policy riders_update on riders;
create policy riders_update on riders for update to authenticated
  using (is_super() or (my_peran() = 'captain' and ds_id = my_ds()) or (my_peran() = 'arcon' and ds_id = any(my_ds_ids())))
  with check (is_super() or (my_peran() = 'captain' and ds_id = my_ds()) or (my_peran() = 'arcon' and ds_id = any(my_ds_ids())));

create or replace function riders_guard() returns trigger language plpgsql as $$
begin
  new.kode_mtr := nullif(upper(trim(new.kode_mtr)), '');
  new.email := nullif(lower(trim(new.email)), '');
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not is_super() then
    if (new.id, new.kode_mtr, new.nama, new.no_hp, new.ds_id, new.peran, new.email)
       is distinct from (old.id, old.kode_mtr, old.nama, old.no_hp, old.ds_id, old.peran, old.email) then
      raise exception 'Captain dan Arcon hanya boleh mengubah status rider';
    end if;
    if new.status is distinct from old.status and old.peran <> 'rider' then
      raise exception 'Hanya Super-admin yang boleh mengubah status Arcon dan Captain';
    end if;
  end if;
  return new;
end $$;
