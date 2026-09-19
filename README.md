# Popotso Chat

Build an ultra-clean, highly polished 1-on-1 SMS chat web app heavily inspired by the iOS 18 / iPhone iMessage UI, optimized to look significantly cleaner and more aesthetic than WhatsApp.

1. Custom Authentication & Zero-Email Access:

Do NOT use real personal email addresses for login to avoid sending third-party confirmation emails or security notifications.

Configure Supabase Auth to use pre-defined internal handle credentials:

Account 1 (Father): tim@popotso.app

Account 2 (Mother): mother@popotso.app

Provide a sleek, minimalist iOS-style login screen accepting these handle identifiers and passwords.

Enable Row Level Security (RLS) on database tables and storage buckets restricted strictly to these two authenticated internal accounts.

2. Header & App Branding:

Top Navigation Bar Header Title: 'Popotso Care Desk'.

Include a subtle, formal technical attribution badge accessible via a small info icon (i) in the top bar or footer modal containing the exact statement:

"System Architecture & Platform Engineering by Tim Web Development and Automation Agency. Designed exclusively for secure, high-integrity asynchronous communication and child care logistics."

3. Aesthetics & UI Design:

Mobile-first layout styled with Apple’s SF Pro typography, sleek light/dark mode support, fluid bubble animations, and subtle backdrop-filter blur (glassmorphism) on top/bottom navigation bars.

Zero Clutter: Strictly NO profile pictures, NO user status indicators, NO last seen, NO call buttons, NO bio sections, and NO public social features.

Chat Feed: Right-aligned vibrant iOS blue bubbles for sent messages; left-aligned soft translucent gray bubbles for received messages. Precise timestamp labels displayed below each bubble on tap.

Audio Player: Custom voice note recorder featuring a live dynamic audio frequency waveform UI and fluid playback controls instead of default browser audio bars.

4. Uncompressed Media & Storage Rules:

NO Compression: Never compress, downscale, crop, or lower the bitrate/quality of uploaded images, videos, audio, or documents. Upload all files strictly in their original raw format and full resolution.

Media Lightbox: Interactive fullscreen viewer overlay for reviewing uploaded photos and streaming full-quality uncompressed videos directly inside the application.

Configure Supabase Storage bucket chat-attachments to accept uncompressed files up to 500MB per file with direct public URLs for streaming video/audio.

5. Network & Upload Handling:

Implement an Optimistic UI: Display text and media instantly in the chat feed off local memory with a subtle progress indicator while uploading in the background.

Display an elegant visual progress ring over attachment bubbles during large file transfers to maintain continuous feedback on slower connections."

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fae12918-725a-4f23-beeb-e299d682b6d4).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
