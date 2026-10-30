# Keytar Live (PWA)
Subí esta carpeta tal cual a un hosting HTTPS (GitHub Pages, Netlify, Cloudflare Pages, Vercel…).
Web MIDI y los Service Workers requieren HTTPS (o localhost). Probar local: `npx serve .`
En Chrome para Android: menú ⋮ → «Instalar app». Después funciona sin internet.
Conectar el teclado: USB-OTG enchufado antes de abrir la app; Bluetooth MIDI emparejado desde Ajustes de Android.
Para actualizar la app: cambiá `V` en sw.js (ej. keytar-live-v2) y volvé a subir.

Recompilar estilos (opcional, si cambiás clases de Tailwind): npx tailwindcss@3.4.17 -i input.css -o style.css --minify
