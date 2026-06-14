# Cara Download APK dari GitHub Actions

## Langkah setelah upload file ke repo:

1. Buka repo di GitHub (dari HP)
2. Tap tab **Actions** (ikon ▶️)
3. Tunggu workflow "Build GESITS APK" selesai (~10-15 menit)
   - 🟡 Kuning = sedang build
   - ✅ Hijau = berhasil
   - ❌ Merah = gagal (cek log)
4. Tap run yang berhasil
5. Scroll ke bawah ke bagian **Artifacts**
6. Tap **GESITS-Dashboard-debug-X** → download ZIP
7. Extract ZIP → install APK
   - Pastikan "Install from unknown sources" sudah diaktifkan di Settings

## Keunggulan vs PWA:
- BLE tetap jalan saat minimize/layar mati
- Tidak perlu browser
- Notifikasi native Android
- Tidak di-throttle OS

## Trigger build manual:
Actions tab → "Build GESITS APK" → "Run workflow" → "Run workflow"
