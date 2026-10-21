-- Pengajuan servis: Super-admin / Arcon mengajukan servis (mis. "Servis rutin Oktober 2026") untuk semua motor di cakupannya.
-- Tiap motor jadi satu item dengan status diminta → dijadwalkan → selesai (atau dilewati dengan alasan).
-- Item otomatis selesai saat servis dengan jenis yang sama dicatat untuk motor itu; pengajuan otomatis selesai kalau semua item beres.
-- Pengajuan yang sudah selesai tetap tersimpan sebagai riwayat.

create table permintaan_servis (
  id uuid primary key default gen_random_uuid(),
  judul text not null check (length(trim(judul)) > 0),
  jenis text not null default 'Servis rutin',
  tenggat date,
  catatan text,
  status text not null default 'berjalan' check (status in ('berjalan', 'selesai')),
  dibuat_oleh uuid references riders(id) on delete set null,
  dibuat timestamptz not null default now(),
  ditutup timestamptz
);

create table permintaan_servis_item (
  id uuid primary key default gen_random_uuid(),
  permintaan_id uuid not null references permintaan_servis(id) on delete cascade,
  motor_id uuid not null references motor(id) on delete cascade,
  status text not null default 'diminta' check (status in ('diminta', 'dijadwalkan', 'selesai', 'dilewati')),
  tanggal_jadwal date,
  servis_id uuid references servis_motor(id) on delete set null,
  selesai_pada date,
  catatan text,
  unique (permintaan_id, motor_id),
  check (status <> 'dilewati' or length(trim(coalesce(catatan, ''))) > 0),
  check (status <> 'dijadwalkan' or tanggal_jadwal is not null)
);
create index permintaan_item_motor_idx on permintaan_servis_item (motor_id, status);
create index permintaan_item_req_idx on permintaan_servis_item (permintaan_id);

-- Motor dan pengajuan induk tidak boleh diganti; tanggal selesai terisi otomatis
create function permintaan_item_siap() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.motor_id, new.permintaan_id) is distinct from (old.motor_id, old.permintaan_id) then
    raise exception 'Motor dan pengajuan pada item tidak bisa diganti';
  end if;
  if new.status = 'selesai' then new.selesai_pada := coalesce(new.selesai_pada, today_wib());
  else new.selesai_pada := null; end if;
  return new;
end $$;
create trigger permintaan_item_siap_t before insert or update on permintaan_servis_item for each row execute function permintaan_item_siap();

-- Pengajuan selesai otomatis kalau tidak ada item yang masih diminta / dijadwalkan; kembali berjalan kalau item dibuka lagi
create function permintaan_sinkron() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.permintaan_id, old.permintaan_id);
begin
  if exists (select 1 from permintaan_servis_item where permintaan_id = v_id and status in ('diminta', 'dijadwalkan')) then
    update permintaan_servis set status = 'berjalan', ditutup = null where id = v_id and status <> 'berjalan';
  else
    update permintaan_servis set status = 'selesai', ditutup = coalesce(ditutup, now()) where id = v_id and status <> 'selesai';
  end if;
  return null;
end $$;
create trigger permintaan_sinkron_t after insert or update on permintaan_servis_item for each row execute function permintaan_sinkron();

-- Servis yang dicatat menyelesaikan item pengajuan berjalan untuk motor dan jenis yang sama (pengajuan tertua dulu)
create function servis_hubungkan() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update permintaan_servis_item set status = 'selesai', servis_id = new.id, selesai_pada = new.tanggal
  where id = (
    select i.id from permintaan_servis_item i join permintaan_servis p on p.id = i.permintaan_id
    where i.motor_id = new.motor_id and i.status in ('diminta', 'dijadwalkan') and p.status = 'berjalan' and p.jenis = new.jenis
    order by p.dibuat limit 1
  );
  return null;
end $$;
create trigger servis_hubungkan_t after insert on servis_motor for each row execute function servis_hubungkan();

-- ───────── hak akses ─────────
create function bisa_lihat_permintaan(p_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select is_super() or exists (select 1 from permintaan_servis_item i where i.permintaan_id = p_id and bisa_lihat_motor(i.motor_id))
$$;

alter table permintaan_servis enable row level security;
alter table permintaan_servis_item enable row level security;
create policy permintaan_read on permintaan_servis for select to authenticated using (bisa_lihat_permintaan(id));
create policy permintaan_hapus on permintaan_servis for delete to authenticated using (is_super());
create policy permintaan_item_read on permintaan_servis_item for select to authenticated using (bisa_lihat_motor(motor_id));
create policy permintaan_item_ubah on permintaan_servis_item for update to authenticated
  using (bisa_kelola_motor(motor_id)) with check (bisa_kelola_motor(motor_id));
revoke all on permintaan_servis, permintaan_servis_item from anon;

-- ───────── buat pengajuan ─────────
-- Super-admin: semua motor (atau satu DS); Arcon: motor di DS yang dipegang (atau satu DS miliknya); Captain tidak bisa.
create function buat_permintaan_servis(p_judul text, p_jenis text, p_tenggat date, p_catatan text default null, p_ds uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  if not (is_super() or my_peran() = 'arcon') then raise exception 'Hanya Super-admin atau Arcon yang bisa membuat pengajuan servis'; end if;
  if length(trim(coalesce(p_judul, ''))) = 0 then raise exception 'Judul pengajuan wajib diisi'; end if;
  if length(trim(coalesce(p_jenis, ''))) = 0 then raise exception 'Jenis servis wajib diisi'; end if;
  if p_tenggat is not null and p_tenggat < today_wib() then raise exception 'Tenggat tidak boleh di masa lalu'; end if;
  if p_ds is not null and not is_super() and not (p_ds = any(my_ds_ids())) then raise exception 'DS tersebut bukan milik Anda'; end if;
  insert into permintaan_servis (judul, jenis, tenggat, catatan, dibuat_oleh)
    values (trim(p_judul), trim(p_jenis), p_tenggat, nullif(trim(coalesce(p_catatan, '')), ''), me()) returning id into v_id;
  insert into permintaan_servis_item (permintaan_id, motor_id)
    select v_id, m.id from motor m
    where (p_ds is null and (is_super() or m.ds_id = any(my_ds_ids()))) or (p_ds is not null and m.ds_id = p_ds);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Tidak ada motor di cakupan yang dipilih'; end if;
  insert into log_aktivitas (captain_id, aksi, detail) values (me(), 'pengajuan servis', trim(p_judul) || ': ' || v_n || ' motor');
  return v_id;
end $$;

-- Kemajuan tiap pengajuan (dihitung di server supaya tidak terkena batas 1000 baris). SECURITY INVOKER: RLS tetap berlaku,
-- jadi tiap peran hanya menghitung motor yang boleh dilihatnya.
create function ringkasan_permintaan() returns table (permintaan_id uuid, total int, selesai int, dilewati int, menunggu int)
language sql stable set search_path = public as $$
  select i.permintaan_id, count(*)::int,
         (count(*) filter (where i.status = 'selesai'))::int,
         (count(*) filter (where i.status = 'dilewati'))::int,
         (count(*) filter (where i.status in ('diminta', 'dijadwalkan')))::int
  from permintaan_servis_item i group by i.permintaan_id
$$;

revoke execute on function buat_permintaan_servis(text, text, date, text, uuid), bisa_lihat_permintaan(uuid), ringkasan_permintaan() from public, anon;
grant execute on function buat_permintaan_servis(text, text, date, text, uuid), bisa_lihat_permintaan(uuid), ringkasan_permintaan() to authenticated;
