-- Super-admin awal. Jalankan SETELAH migrasi, lalu buat user Auth dengan email yang SAMA
-- di Supabase Dashboard → Authentication → Users → Add user (centang Auto Confirm).
-- Super-admin berikutnya bisa ditambah dari dalam app (tab Kelola DS & Captain).
insert into riders (nama, email, peran) values
  ('Super Admin 1', 'ipientrazrasta@gmail.com', 'super_admin'),
  ('Naipin', 'naipin.aja@dashelectric.co', 'super_admin')
on conflict (email) do update set peran = 'super_admin', status = 'aktif';
