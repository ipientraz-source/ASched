-- Status Arcon, Captain, dan Super-admin (aktif / nonaktif) hanya boleh diubah Super-admin.
-- Sebelumnya Captain boleh mengubah status SEMUA baris riders di DS-nya, termasuk baris Captain lain atau dirinya sendiri.
-- Penjagaan ada di trigger supaya berlaku untuk semua jalur (UI, API langsung). RPC SECURITY DEFINER tidak terkena (current_user bukan 'authenticated').
create or replace function riders_guard() returns trigger language plpgsql as $$
begin
  new.kode_mtr := nullif(upper(trim(new.kode_mtr)), '');
  new.email := nullif(lower(trim(new.email)), '');
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not is_super() then
    if (new.id, new.kode_mtr, new.nama, new.no_hp, new.ds_id, new.peran, new.email)
       is distinct from (old.id, old.kode_mtr, old.nama, old.no_hp, old.ds_id, old.peran, old.email) then
      raise exception 'Captain hanya boleh mengubah status rider';
    end if;
    if new.status is distinct from old.status and old.peran <> 'rider' then
      raise exception 'Hanya Super-admin yang boleh mengubah status Arcon dan Captain';
    end if;
  end if;
  return new;
end $$;
