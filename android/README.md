# Popotso File Upload Android companion

This is a separate, visible Android companion app. It is not embedded in chat and does not hide itself. Android media permission is requested by the app; users can decline or revoke it in Android Settings. Backup starts only after pairing and explicit user action.

## Setup still required before an APK can be built
1. Apply both SQL migrations in `supabase/migrations`.
2. Deploy `supabase/functions/file-upload` and configure Supabase Edge Function secrets.
3. Replace `REPLACE_WITH_SUPABASE_PUBLISHABLE_KEY` in `app/build.gradle.kts` with the project's publishable key (never a service-role key).
4. Complete the pairing screen/flow and verify signed-upload API behaviour against the live Supabase project.
5. Build with Android SDK: `./gradlew :app:assembleDebug`.

The current companion includes explicit permission requests and a one-time MediaStore backup worker. Pairing UI, resumable/chunked uploads, background scheduling, and on-device end-to-end verification remain outstanding. It is not yet an installable release APK.
