-- Super-admin menghapus jadwal tersimpan satu DS untuk satu minggu (Senin–Minggu), mis. saat ada rider baru
-- padahal Captain sudah menyimpan jadwal. Captain lalu bisa menyusun ulang.
-- Dilindungi: minggu yang absensinya sudah terisi atau sudah dikunci tidak bisa dihapus (rekap dan gaji bergantung padanya).
-- Kebutuhan harian (kuota_harian) tidak ikut terhapus.

create function hapus_jadwal(p_ds uuid, p_minggu date) returns int
language plpgsql security definer set search_path = public as $$
declare v_senin date := date_trunc('week', p_minggu)::date; v_n int; v_nama text;
begin
  if not is_super() then raise exception 'Hanya Super-admin yang bisa menghapus jadwal'; end if;
  select nama into v_nama from ds where id = p_ds;
  if v_nama is null then raise exception 'DS tidak ditemukan'; end if;
  if exists (select 1 from periode_kunci where ds_id = p_ds and minggu_mulai = v_senin) then
    raise exception 'Absensi minggu ini sudah dikunci, jadwalnya tidak bisa dihapus';
  end if;
  if exists (select 1 from actual_harian where ds_id = p_ds and tanggal between v_senin and v_senin + 6) then
    raise exception 'Minggu ini sudah ada absensi yang diisi, jadwalnya tidak bisa dihapus';
  end if;
  delete from jadwal where ds_id = p_ds and tanggal between v_senin and v_senin + 6;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Tidak ada jadwal untuk dihapus di minggu ini'; end if;
  insert into log_aktivitas (captain_id, aksi, detail)
    values (me(), 'hapus jadwal', v_nama || ': minggu ' || v_senin || ', ' || v_n || ' baris');
  return v_n;
end $$;

revoke execute on function hapus_jadwal(uuid, date) from public, anon;
grant execute on function hapus_jadwal(uuid, date) to authenticated;
