-- Dash Scheduler — skema, RLS, RPC. Semua aturan akses ada di sini (bukan di UI).

create type peran_t as enum ('rider', 'captain', 'super_admin');
create type shift_t as enum ('pagi', 'siang', 'off');
create type status_rider_t as enum ('aktif', 'nonaktif');
create type actual_status_t as enum ('hadir', 'alpha', 'izin', 'sakit', 'tukar', 'pengganti');

-- ───────── tabel ─────────
create table ds (
  id uuid primary key default gen_random_uuid(),
  nama text not null unique,
  kuota_pagi int not null default 0 check (kuota_pagi >= 0),
  kuota_siang int not null default 0 check (kuota_siang >= 0),
  captain_id uuid unique,
  group_wa_id text
);

create table riders (
  id uuid primary key default gen_random_uuid(),
  kode_mtr text unique,
  nama text not null,
  no_hp text,
  ds_id uuid references ds(id) on delete set null,
  status status_rider_t not null default 'aktif',
  peran peran_t not null default 'rider',
  email text unique
);
alter table ds add constraint ds_captain_fk foreign key (captain_id) references riders(id) on delete set null;
create index on riders (ds_id);

create table jadwal (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null,
  rider_id uuid not null references riders(id) on delete cascade,
  shift shift_t not null,
  ds_id uuid not null references ds(id) on delete cascade,
  unique (tanggal, rider_id)
);
create index on jadwal (ds_id, tanggal);

create table actual_harian (
  id uuid primary key default gen_random_uuid(),
  tanggal date not null,
  rider_id uuid not null references riders(id) on delete cascade,
  ds_id uuid not null references ds(id) on delete cascade,
  status actual_status_t not null,
  backup_untuk_id uuid references riders(id) on delete set null,
  penjelasan text,
  diinput_oleh uuid references riders(id) on delete set null,
  jam_input timestamptz not null default now(),
  periode_terkunci boolean not null default false,
  unique (tanggal, rider_id)
);
create index on actual_harian (ds_id, tanggal);

create table periode_kunci (
  ds_id uuid not null references ds(id) on delete cascade,
  minggu_mulai date not null,
  dikunci_oleh uuid references riders(id) on delete set null,
  waktu timestamptz not null default now(),
  primary key (ds_id, minggu_mulai)
);

create table perpindahan_rider (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references riders(id) on delete cascade,
  dari_ds uuid references ds(id) on delete set null,
  ke_ds uuid references ds(id) on delete set null,
  ditarik_oleh uuid references riders(id) on delete set null,
  waktu timestamptz not null default now()
);

create table log_aktivitas (
  id uuid primary key default gen_random_uuid(),
  captain_id uuid references riders(id) on delete set null,
  aksi text not null,
  detail text,
  waktu timestamptz not null default now()
);

create table notifikasi (
  id uuid primary key default gen_random_uuid(),
  penerima_id uuid not null references riders(id) on delete cascade,
  pesan text not null,
  dibaca boolean not null default false,
  waktu timestamptz not null default now()
);

create table motor (
  id uuid primary key default gen_random_uuid(),
  kode_motor text not null unique,
  dipegang_oleh uuid references riders(id) on delete set null,
  kelengkapan text,
  status text not null default 'di gudang' check (status in ('dipakai', 'di gudang', 'perbaikan'))
);

-- ───────── helper identitas (SECURITY DEFINER agar tidak rekursif di RLS) ─────────
create function me() returns uuid language sql stable security definer set search_path = public as $$
  select id from riders
  where email = lower(auth.jwt() ->> 'email') and status = 'aktif' limit 1
$$;
create function my_peran() returns peran_t language sql stable security definer set search_path = public as $$
  select peran from riders where id = me()
$$;
create function is_super() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_peran() = 'super_admin', false)
$$;
create function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_peran() in ('captain', 'super_admin'), false)
$$;
-- DS yang dipegang Captain (null untuk selain Captain)
create function my_ds() returns uuid language sql stable security definer set search_path = public as $$
  select id from ds where captain_id = me() and my_peran() = 'captain'
$$;
create function today_wib() returns date language sql stable as $$
  select (now() at time zone 'Asia/Jakarta')::date
$$;

-- ───────── RLS ─────────
alter table ds enable row level security;
alter table riders enable row level security;
alter table jadwal enable row level security;
alter table actual_harian enable row level security;
alter table periode_kunci enable row level security;
alter table perpindahan_rider enable row level security;
alter table log_aktivitas enable row level security;
alter table notifikasi enable row level security;
alter table motor enable row level security;

-- ds: semua admin boleh baca (nama DS untuk dropdown), tulis hanya Super-admin
create policy ds_read on ds for select to authenticated using (is_admin());
create policy ds_write on ds for all to authenticated using (is_super()) with check (is_super());

-- riders: Super-admin semua; Captain hanya rider DS-nya + dirinya
create policy riders_read on riders for select to authenticated
  using (is_super() or (my_peran() = 'captain' and (ds_id = my_ds() or id = me())));
create policy riders_insert on riders for insert to authenticated with check (is_super());
create policy riders_update on riders for update to authenticated
  using (is_super() or (my_peran() = 'captain' and ds_id = my_ds()))
  with check (is_super() or (my_peran() = 'captain' and ds_id = my_ds()));
create policy riders_delete on riders for delete to authenticated using (is_super());

-- jadwal & actual: baca saja; tulis lewat RPC
create policy jadwal_read on jadwal for select to authenticated
  using (is_super() or (my_peran() = 'captain' and ds_id = my_ds()) or rider_id = me());
create policy actual_read on actual_harian for select to authenticated
  using (is_super() or (my_peran() = 'captain' and ds_id = my_ds()));
create policy kunci_read on periode_kunci for select to authenticated
  using (is_super() or ds_id = my_ds());
create policy pindah_read on perpindahan_rider for select to authenticated
  using (is_super() or dari_ds = my_ds() or ke_ds = my_ds());
create policy log_read on log_aktivitas for select to authenticated
  using (is_super() or captain_id = me());
create policy notif_read on notifikasi for select to authenticated using (penerima_id = me());
create policy notif_update on notifikasi for update to authenticated
  using (penerima_id = me()) with check (penerima_id = me());
create policy motor_read on motor for select to authenticated using (is_admin());
create policy motor_write on motor for all to authenticated using (is_super()) with check (is_super());

-- ───────── trigger ─────────
-- Normalisasi kode/email; Captain hanya boleh mengubah status rider (kolom lain Super-admin / RPC).
create function riders_guard() returns trigger language plpgsql as $$
begin
  new.kode_mtr := nullif(upper(trim(new.kode_mtr)), '');
  new.email := nullif(lower(trim(new.email)), '');
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not is_super() then
    if (new.id, new.kode_mtr, new.nama, new.no_hp, new.ds_id, new.peran, new.email)
       is distinct from (old.id, old.kode_mtr, old.nama, old.no_hp, old.ds_id, old.peran, old.email) then
      raise exception 'Captain hanya boleh mengubah status rider';
    end if;
  end if;
  return new;
end $$;
create trigger riders_guard_t before insert or update on riders for each row execute function riders_guard();

-- Setiap perpindahan DS tercatat + Captain lama dinotifikasi (berlaku untuk semua jalur: UI, RPC, import)
create function riders_ds_log() returns trigger language plpgsql security definer set search_path = public as $$
declare v_old_cap uuid; v_ds_baru text;
begin
  if new.ds_id is distinct from old.ds_id then
    insert into perpindahan_rider (rider_id, dari_ds, ke_ds, ditarik_oleh) values (new.id, old.ds_id, new.ds_id, me());
    select captain_id into v_old_cap from ds where id = old.ds_id;
    select nama into v_ds_baru from ds where id = new.ds_id;
    if v_old_cap is not null and v_old_cap is distinct from me() then
      insert into notifikasi (penerima_id, pesan)
      values (v_old_cap, new.nama || ' dipindah dari DS Anda ke ' || coalesce(v_ds_baru, 'kolam bebas'));
    end if;
    if my_peran() = 'captain' then
      insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'tarik rider', new.nama || ' -> ' || coalesce(v_ds_baru, 'kolam bebas'));
    end if;
  end if;
  return new;
end $$;
create trigger riders_ds_log_t after update of ds_id on riders for each row execute function riders_ds_log();

-- Actual yang periodenya (Senin–Minggu) sudah dikunci tidak bisa diubah
create function actual_lock_guard() returns trigger language plpgsql as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and exists (
    select 1 from periode_kunci where ds_id = new.ds_id and minggu_mulai = date_trunc('week', new.tanggal)::date
  ) then raise exception 'Periode % sudah dikunci', new.tanggal; end if;
  if tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from periode_kunci where ds_id = old.ds_id and minggu_mulai = date_trunc('week', old.tanggal)::date
  ) then raise exception 'Periode % sudah dikunci', old.tanggal; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger actual_lock_guard_t before insert or update or delete on actual_harian
  for each row execute function actual_lock_guard();

-- ───────── RPC ─────────
-- Login rider via Kode MTR (anon). Hanya mengembalikan jadwal milik kode itu.
create function jadwal_rider(p_kode text)
returns table (nama text, ds_nama text, tanggal date, shift shift_t)
language sql stable security definer set search_path = public as $$
  select r.nama, d.nama, j.tanggal, j.shift
  from riders r
  left join jadwal j on j.rider_id = r.id and j.tanggal >= today_wib()
  left join ds d on d.id = j.ds_id
  where r.kode_mtr = upper(trim(p_kode)) and r.status = 'aktif'
  order by j.tanggal
  limit 60
$$;

-- Cari rider seluruh DS (nama / Kode MTR). Kode MTR sengaja tidak dikembalikan (itu kunci login rider).
create function cari_rider(p_q text)
returns table (id uuid, nama text, ds_id uuid, ds_nama text, status status_rider_t)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Tidak berwenang'; end if;
  return query
    select r.id, r.nama, r.ds_id, d.nama, r.status
    from riders r left join ds d on d.id = r.ds_id
    where r.peran = 'rider' and (r.nama ilike '%' || p_q || '%' or r.kode_mtr ilike '%' || p_q || '%')
    order by r.nama limit 20;
end $$;

-- Captain menarik rider (kolam bebas / DS lain) ke DS-nya; log + notifikasi lewat trigger
create function tarik_rider(p_rider uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_ds uuid := my_ds();
begin
  if v_ds is null then raise exception 'Hanya Captain yang bisa menarik rider'; end if;
  update riders set ds_id = v_ds where id = p_rider and peran = 'rider' and ds_id is distinct from v_ds;
  if not found then raise exception 'Rider tidak ditemukan / sudah di DS Anda'; end if;
end $$;

-- Simpan jadwal DS untuk rentang tanggal (ganti-per-DS: rentang itu ditimpa utuh)
-- p_rows: [{"tanggal":"2026-10-26","rider_id":"...","shift":"pagi"}]
create function simpan_jadwal(p_ds uuid, p_dari date, p_sampai date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_ds is distinct from my_ds() then raise exception 'Hanya Captain DS ini yang bisa menyusun jadwal'; end if;
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
    values (me(), 'ubah jadwal', p_dari || ' s/d ' || p_sampai || ': ' || v_n || ' baris');
  return v_n;
end $$;

-- Catat actual satu rider. Backup (alpha) / rekan tukar (tukar) tersimpan satu paket.
create function catat_actual(p_tanggal date, p_rider uuid, p_status actual_status_t,
                             p_backup uuid default null, p_penjelasan text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ds uuid := my_ds(); v_me uuid := me();
begin
  if v_ds is null then raise exception 'Hanya Captain yang bisa mengisi actual'; end if;
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

-- Batalkan marking (kembali ke "belum diisi"), termasuk paket backup-nya
create function hapus_actual(p_tanggal date, p_rider uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ds uuid := my_ds();
begin
  if v_ds is null then raise exception 'Hanya Captain'; end if;
  delete from actual_harian where tanggal = p_tanggal and ds_id = v_ds
    and (rider_id = p_rider or (backup_untuk_id = p_rider and status = 'pengganti'));
end $$;

-- Kunci actual satu minggu (Senin–Minggu) untuk satu DS. Hanya minggu yang sudah lewat.
create function kunci_periode(p_ds uuid, p_minggu date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_super() or p_ds = my_ds()) then raise exception 'Tidak berwenang'; end if;
  if p_minggu <> date_trunc('week', p_minggu)::date then raise exception 'Tanggal harus hari Senin'; end if;
  if p_minggu + 6 >= today_wib() then raise exception 'Minggu ini belum selesai, belum bisa dikunci'; end if;
  update actual_harian set periode_terkunci = true where ds_id = p_ds and tanggal between p_minggu and p_minggu + 6;
  insert into periode_kunci (ds_id, minggu_mulai, dikunci_oleh) values (p_ds, p_minggu, me())
    on conflict do nothing;
end $$;

-- Import CSV rider (Super-admin). Kunci gabung = kode_mtr. Rider yang tak ada di file dibiarkan.
-- p_rows: [{"baris":2,"kode_mtr":"MTR001","nama":"..","no_hp":"..","ds":"Galaxy","status":"aktif"}]
create function import_riders(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; v_ds uuid; v_kode text; v_status status_rider_t;
  v_ins int := 0; v_upd int := 0; v_err jsonb := '[]'::jsonb;
begin
  if not is_super() then raise exception 'Hanya Super-admin'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as x(baris int, kode_mtr text, nama text, no_hp text, ds text, status text) loop
    v_kode := upper(trim(coalesce(r.kode_mtr, '')));
    v_ds := null;
    if v_kode = '' or trim(coalesce(r.nama, '')) = '' then
      v_err := v_err || jsonb_build_object('baris', r.baris, 'pesan', 'kode_mtr dan nama wajib diisi'); continue;
    end if;
    if trim(coalesce(r.status, '')) not in ('', 'aktif', 'nonaktif') then
      v_err := v_err || jsonb_build_object('baris', r.baris, 'pesan', 'status harus aktif / nonaktif'); continue;
    end if;
    v_status := coalesce(nullif(trim(r.status), ''), 'aktif')::status_rider_t;
    if trim(coalesce(r.ds, '')) <> '' then
      select id into v_ds from ds where lower(nama) = lower(trim(r.ds));
      if v_ds is null then
        v_err := v_err || jsonb_build_object('baris', r.baris, 'pesan', 'DS ''' || trim(r.ds) || ''' tidak ditemukan'); continue;
      end if;
    end if;
    if exists (select 1 from riders where kode_mtr = v_kode) then
      update riders set nama = trim(r.nama), no_hp = coalesce(nullif(trim(r.no_hp), ''), no_hp),
        ds_id = coalesce(v_ds, ds_id), status = case when trim(coalesce(r.status, '')) = '' then status else v_status end
      where kode_mtr = v_kode;
      v_upd := v_upd + 1;
    else
      insert into riders (kode_mtr, nama, no_hp, ds_id, status)
        values (v_kode, trim(r.nama), nullif(trim(r.no_hp), ''), v_ds, v_status);
      v_ins := v_ins + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'errors', v_err);
end $$;

-- ───────── laporan (SECURITY INVOKER → RLS otomatis membatasi Captain ke DS-nya) ─────────
create function laporan_rider(p_dari date, p_sampai date)
returns table (rider_id uuid, kode_mtr text, nama text, ds_nama text, dijadwalkan int, hadir int,
               alpha int, izin int, sakit int, tukar int, pengganti int, belum_diisi int)
language sql stable as $$
  with x as (
    select coalesce(s.rider_id, a.rider_id) rid, coalesce(s.tanggal, a.tanggal) tgl,
           s.rider_id is not null as sched, a.status
    from (select rider_id, tanggal from jadwal where shift <> 'off' and tanggal between p_dari and p_sampai) s
    full join (select rider_id, tanggal, status from actual_harian where tanggal between p_dari and p_sampai) a
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
    (count(*) filter (where x.sched and x.status is null and x.tgl <= today_wib()))::int
  from x join riders r on r.id = x.rid left join ds d on d.id = r.ds_id
  group by r.id, r.kode_mtr, r.nama, d.nama
  order by r.nama
$$;

create function laporan_ds(p_dari date, p_sampai date)
returns table (ds_id uuid, ds_nama text, dijadwalkan int, patuh int, alpha int, tukar int, pengganti int,
               belum_diisi int, hari_belum_isi int, terakhir_input timestamptz)
language sql stable as $$
  select d.id, d.nama,
    (select count(*) from jadwal j where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai)::int,
    (select count(*) from jadwal j join actual_harian a on a.tanggal = j.tanggal and a.rider_id = j.rider_id
       where j.ds_id = d.id and j.shift <> 'off' and j.tanggal between p_dari and p_sampai and a.status = 'hadir')::int,
    (select count(*) from actual_harian a where a.ds_id = d.id and a.tanggal between p_dari and p_sampai and a.status = 'alpha')::int,
    (select count(*) from actual_harian a where a.ds_id = d.id and a.tanggal between p_dari and p_sampai and a.status = 'tukar')::int,
    (select count(*) from actual_harian a where a.ds_id = d.id and a.tanggal between p_dari and p_sampai and a.status = 'pengganti')::int,
    (select count(*) from jadwal j where j.ds_id = d.id and j.shift <> 'off'
       and j.tanggal between p_dari and least(p_sampai, today_wib())
       and not exists (select 1 from actual_harian a where a.tanggal = j.tanggal and a.rider_id = j.rider_id))::int,
    (select count(distinct j.tanggal) from jadwal j where j.ds_id = d.id and j.shift <> 'off'
       and j.tanggal between p_dari and least(p_sampai, today_wib())
       and not exists (select 1 from actual_harian a where a.tanggal = j.tanggal and a.ds_id = d.id))::int,
    (select max(a.jam_input) from actual_harian a where a.ds_id = d.id)
  from ds d
  where is_super() or d.id = my_ds()
  order by d.nama
$$;

-- ───────── hak eksekusi ─────────
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function jadwal_rider(text) to anon;
