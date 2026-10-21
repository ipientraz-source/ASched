-- Fleet management: data EV, servis rutin, laporan kerusakan, pemindahan antar DS, foto di Storage.
-- Hak akses: Super-admin kelola semua; Arcon kelola penuh motor di DS yang dipegang; Captain melihat motor DS-nya dan
-- melaporkan kerusakan; rider tidak punya akses.
-- Foto TIDAK disimpan di database: hanya alamat berkasnya (teks) yang disimpan; berkasnya ada di bucket Storage 'armada'.

-- ───────── motor: perluas tabel yang sudah ada ─────────
alter table motor
  add column ds_id uuid references ds(id) on delete restrict,
  add column plat_nomor text,
  add column merek text,
  add column model text,
  add column tahun int check (tahun between 2000 and 2100),
  add column warna text,
  add column no_rangka text,
  add column no_mesin text,
  add column tanggal_beli date,
  add column interval_servis_hari int check (interval_servis_hari between 1 and 730),
  add column servis_terakhir date,
  add column servis_berikutnya date,
  add column catatan text,
  add column dibuat timestamptz not null default now(),
  add constraint motor_ds_wajib check (ds_id is not null) not valid;
create unique index motor_plat_uniq on motor (plat_nomor) where plat_nomor is not null;
create unique index motor_rangka_uniq on motor (no_rangka) where no_rangka is not null;
create unique index motor_mesin_uniq on motor (no_mesin) where no_mesin is not null;
create index motor_ds_idx on motor (ds_id);

-- Normalisasi teks, rider pemegang harus rider di DS yang sama, status 'dipakai/di gudang' diturunkan dari pemegang
-- (hanya 'perbaikan' yang diatur terpisah), dan DS tidak boleh diubah langsung (lewat pindah_motor).
create function motor_guard() returns trigger language plpgsql as $$
begin
  new.kode_motor := upper(trim(new.kode_motor));
  new.plat_nomor := nullif(upper(regexp_replace(trim(coalesce(new.plat_nomor, '')), '\s+', ' ', 'g')), '');
  new.no_rangka := nullif(upper(trim(coalesce(new.no_rangka, ''))), '');
  new.no_mesin := nullif(upper(trim(coalesce(new.no_mesin, ''))), '');
  if tg_op = 'UPDATE' and new.ds_id is distinct from old.ds_id and current_user = 'authenticated' then
    raise exception 'Motor dipindahkan lewat tombol Pindah DS, bukan dengan mengubah isian';
  end if;
  if new.dipegang_oleh is not null
     and not exists (select 1 from riders where id = new.dipegang_oleh and ds_id = new.ds_id and peran = 'rider') then
    raise exception 'Rider pemegang motor harus rider di DS yang sama';
  end if;
  if new.status <> 'perbaikan' then
    new.status := case when new.dipegang_oleh is not null then 'dipakai' else 'di gudang' end;
  end if;
  return new;
end $$;
create trigger motor_guard_t before insert or update on motor for each row execute function motor_guard();

-- ───────── servis ─────────
create table servis_motor (
  id uuid primary key default gen_random_uuid(),
  motor_id uuid not null references motor(id) on delete cascade,
  tanggal date not null,
  jenis text not null,
  jenis_lain text,
  bengkel text,
  kilometer int check (kilometer >= 0),
  biaya int not null default 0 check (biaya >= 0),
  ditanggung_asuransi boolean not null default false,
  catatan text,
  foto text[] not null default '{}' check (cardinality(foto) <= 4),
  diinput_oleh uuid references riders(id) on delete set null,
  dibuat timestamptz not null default now(),
  check (not ditanggung_asuransi or biaya = 0),
  check (jenis <> 'Lainnya' or length(trim(coalesce(jenis_lain, ''))) > 0)
);
create index servis_motor_idx on servis_motor (motor_id, tanggal desc);

-- Servis rutin memajukan jadwal servis berikutnya (tanggal servis + interval yang diatur di motor)
create function servis_sinkron() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.jenis = 'Servis rutin' then
    update motor set servis_terakhir = new.tanggal,
                     servis_berikutnya = case when interval_servis_hari is not null then new.tanggal + interval_servis_hari else servis_berikutnya end
    where id = new.motor_id and (servis_terakhir is null or new.tanggal >= servis_terakhir);
  end if;
  return new;
end $$;
create trigger servis_sinkron_t after insert on servis_motor for each row execute function servis_sinkron();

create function servis_siap() returns trigger language plpgsql as $$
begin
  if new.diinput_oleh is null then new.diinput_oleh := me(); end if;
  if new.jenis <> 'Lainnya' then new.jenis_lain := null; end if;
  return new;
end $$;
create trigger servis_siap_t before insert or update on servis_motor for each row execute function servis_siap();

-- ───────── kerusakan ─────────
create table kerusakan_motor (
  id uuid primary key default gen_random_uuid(),
  motor_id uuid not null references motor(id) on delete cascade,
  tanggal date not null default today_wib(),
  jenis text not null,
  jenis_lain text,
  keparahan text not null check (keparahan in ('ringan', 'sedang', 'berat')),
  deskripsi text not null check (length(trim(deskripsi)) > 0),
  pelapor_id uuid references riders(id) on delete set null,
  status text not null default 'dilaporkan' check (status in ('dilaporkan', 'diproses', 'selesai')),
  biaya int not null default 0 check (biaya >= 0),
  ditanggung_asuransi boolean not null default false,
  tanggal_selesai date,
  catatan_perbaikan text,
  foto text[] not null default '{}' check (cardinality(foto) <= 4),
  dibuat timestamptz not null default now(),
  check (not ditanggung_asuransi or biaya = 0),
  check (jenis <> 'Lainnya' or length(trim(coalesce(jenis_lain, ''))) > 0)
);
create index kerusakan_motor_idx on kerusakan_motor (motor_id, tanggal desc);
create index kerusakan_status_idx on kerusakan_motor (status);

create function kerusakan_siap() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.pelapor_id is null then new.pelapor_id := me(); end if;
  if new.jenis <> 'Lainnya' then new.jenis_lain := null; end if;
  if new.status = 'selesai' then new.tanggal_selesai := coalesce(new.tanggal_selesai, today_wib());
  else new.tanggal_selesai := null; end if;
  return new;
end $$;
create trigger kerusakan_siap_t before insert or update on kerusakan_motor for each row execute function kerusakan_siap();

-- Motor berstatus 'perbaikan' selama ada laporan yang sedang 'diproses'; selesai semua → kembali ke dipakai / di gudang
create function kerusakan_sinkron() returns trigger language plpgsql security definer set search_path = public as $$
declare v_motor uuid := coalesce(new.motor_id, old.motor_id);
begin
  update motor set status = case when exists (select 1 from kerusakan_motor k where k.motor_id = motor.id and k.status = 'diproses')
                                 then 'perbaikan' else 'di gudang' end
  where id = v_motor;
  return null;
end $$;
create trigger kerusakan_sinkron_t after insert or update or delete on kerusakan_motor for each row execute function kerusakan_sinkron();

-- ───────── riwayat pemindahan ─────────
create table perpindahan_motor (
  id uuid primary key default gen_random_uuid(),
  motor_id uuid not null references motor(id) on delete cascade,
  dari_ds uuid references ds(id) on delete set null,
  ke_ds uuid references ds(id) on delete set null,
  alasan text not null,
  oleh uuid references riders(id) on delete set null,
  waktu timestamptz not null default now()
);
create index perpindahan_motor_idx on perpindahan_motor (motor_id, waktu desc);

-- ───────── helper hak akses ─────────
create function bisa_lihat_motor(p_motor uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_super() or exists (select 1 from motor m where m.id = p_motor and m.ds_id = any(my_ds_ids()))
$$;
create function bisa_kelola_motor(p_motor uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_super() or exists (select 1 from motor m where m.id = p_motor and my_peran() = 'arcon' and m.ds_id = any(my_ds_ids()))
$$;

-- ───────── RLS ─────────
alter table servis_motor enable row level security;
alter table kerusakan_motor enable row level security;
alter table perpindahan_motor enable row level security;

drop policy motor_read on motor;
drop policy motor_write on motor;
create policy motor_read on motor for select to authenticated
  using (is_super() or ds_id = any(my_ds_ids()));
create policy motor_write on motor for all to authenticated
  using (is_super() or (my_peran() = 'arcon' and ds_id = any(my_ds_ids())))
  with check (is_super() or (my_peran() = 'arcon' and ds_id = any(my_ds_ids())));

create policy servis_read on servis_motor for select to authenticated using (bisa_lihat_motor(motor_id));
create policy servis_write on servis_motor for all to authenticated
  using (bisa_kelola_motor(motor_id)) with check (bisa_kelola_motor(motor_id));

create policy kerusakan_read on kerusakan_motor for select to authenticated using (bisa_lihat_motor(motor_id));
create policy kerusakan_kelola on kerusakan_motor for all to authenticated
  using (bisa_kelola_motor(motor_id)) with check (bisa_kelola_motor(motor_id));
-- Captain hanya melapor: motor di DS-nya, atas namanya, status awal, tanpa biaya
create policy kerusakan_lapor on kerusakan_motor for insert to authenticated
  with check (
    my_peran() = 'captain' and pelapor_id = me() and status = 'dilaporkan' and biaya = 0
    and not ditanggung_asuransi and catatan_perbaikan is null
    and exists (select 1 from motor m where m.id = motor_id and m.ds_id = my_ds())
  );

create policy pindah_read on perpindahan_motor for select to authenticated
  using (is_super() or dari_ds = any(my_ds_ids()) or ke_ds = any(my_ds_ids()));

revoke all on servis_motor, kerusakan_motor, perpindahan_motor from anon;

-- ───────── pindah DS ─────────
-- Syarat: Super-admin, atau Arcon yang memegang DS asal DAN tujuan; alasan wajib; tidak ada laporan kerusakan yang belum
-- selesai dan motor tidak sedang diperbaiki; rider pemegang dilepas otomatis; tercatat di riwayat dan log.
create function pindah_motor(p_motor uuid, p_ke_ds uuid, p_alasan text) returns void
language plpgsql security definer set search_path = public as $$
declare v_dari uuid; v_status text; v_kode text; v_ke text;
begin
  select ds_id, status, kode_motor into v_dari, v_status, v_kode from motor where id = p_motor;
  if not found then raise exception 'Motor tidak ditemukan'; end if;
  if not is_super() and not (my_peran() = 'arcon' and v_dari = any(my_ds_ids()) and p_ke_ds = any(my_ds_ids())) then
    raise exception 'Hanya Super-admin, atau Arcon yang memegang DS asal dan DS tujuan, yang bisa memindahkan motor';
  end if;
  select nama into v_ke from ds where id = p_ke_ds;
  if v_ke is null then raise exception 'DS tujuan tidak ditemukan'; end if;
  if v_dari is not distinct from p_ke_ds then raise exception 'Motor sudah berada di DS tersebut'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan pemindahan wajib diisi'; end if;
  if v_status = 'perbaikan'
     or exists (select 1 from kerusakan_motor where motor_id = p_motor and status in ('dilaporkan', 'diproses')) then
    raise exception 'Motor masih punya laporan kerusakan yang belum selesai. Selesaikan dulu sebelum dipindah';
  end if;
  update motor set ds_id = p_ke_ds, dipegang_oleh = null where id = p_motor;
  insert into perpindahan_motor (motor_id, dari_ds, ke_ds, alasan, oleh) values (p_motor, v_dari, p_ke_ds, trim(p_alasan), me());
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), 'pindah motor', v_kode || ' → ' || v_ke || ': ' || trim(p_alasan));
end $$;

revoke execute on function pindah_motor(uuid, uuid, text), bisa_lihat_motor(uuid), bisa_kelola_motor(uuid) from public, anon;
grant execute on function pindah_motor(uuid, uuid, text), bisa_lihat_motor(uuid), bisa_kelola_motor(uuid) to authenticated;

-- ───────── Storage: bucket privat 'armada' (hanya di Supabase; dilewati di database uji yang tidak punya schema storage) ─────────
-- Nama berkas: {motor_id}/{uuid}.jpg. Akses mengikuti hak lihat motor; hapus hanya Super-admin dan Arcon.
create function armada_boleh(p_nama text, p_hapus boolean) returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_id text := split_part(p_nama, '/', 1);
begin
  if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if p_hapus then return bisa_kelola_motor(v_id::uuid); end if;
  return bisa_lihat_motor(v_id::uuid);
end $$;
revoke execute on function armada_boleh(text, boolean) from public, anon;
grant execute on function armada_boleh(text, boolean) to authenticated;

do $storage$
begin
  if to_regnamespace('storage') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('armada', 'armada', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists armada_baca on storage.objects;
    drop policy if exists armada_unggah on storage.objects;
    drop policy if exists armada_hapus on storage.objects;
    create policy armada_baca on storage.objects for select to authenticated
      using (bucket_id = 'armada' and public.armada_boleh(name, false));
    create policy armada_unggah on storage.objects for insert to authenticated
      with check (bucket_id = 'armada' and public.armada_boleh(name, false));
    create policy armada_hapus on storage.objects for delete to authenticated
      using (bucket_id = 'armada' and public.armada_boleh(name, true));
  end if;
end
$storage$;
