-- Peran baru: Arcon (atasan Captain, memegang beberapa DS).
-- Dipisah dari migrasi berikutnya karena nilai enum baru tidak boleh dipakai dalam transaksi yang sama
-- dengan penambahannya. Jalankan file ini LEBIH DULU dan sendirian, baru jalankan 20261020000003_arcon.sql.
alter type peran_t add value if not exists 'arcon';
