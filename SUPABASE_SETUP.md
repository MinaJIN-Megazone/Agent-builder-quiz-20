# Supabase Setup

The quiz uses public Edge Function endpoints; participants do not need a Supabase or Microsoft account. Participant names and departments are stored in a private schema, separate from scores. The public leaderboard returns full names, scores, ranks, and submission times only; it never returns departments.

## Project Setup

1. Create a Supabase project and keep its database password and server keys private.
2. Install the Supabase CLI, then link this folder with `supabase link --project-ref <project-ref>`.
3. Apply the schema with `supabase db push`.
4. Set the event end time in the SQL Editor before opening registration:

   ```sql
   update private.quiz_settings
   set event_ends_at = '2026-12-01 18:00:00+09', retention_days = 7
   where singleton = true;
   ```

   Replace the example timestamp and retention period with the approved event values. Registration remains open while `event_ends_at` is null, so set it before sharing the public URL.

5. Edit the ignored `supabase/functions/.env` file and set `ALLOWED_ORIGINS` to the exact GitHub Pages origin, for example `https://<account>.github.io`. Add a separate origin if using a custom domain. The file contains the answer key but is excluded from Git by `.gitignore`.
6. Upload the Edge Function secrets with `supabase secrets set --env-file supabase/functions/.env`, or enter the two values in the Dashboard's Edge Function Secrets page. The answer key must contain 20 answer indexes and 20 point values whose sum is 1,000. Never put the server answer key or Supabase server key in the HTML, GitHub repository, or browser storage.
7. Deploy `start-quiz`, `submit-quiz`, and `leaderboard` with the Supabase CLI. The Supabase server key is read only inside Edge Functions and must never be copied into `index.html`.
8. Set `SUPABASE_CONFIG.url` and `SUPABASE_CONFIG.publishableKey` in `index.html`. The publishable key is intended for browser use; the server key is not.
9. Enable `pg_cron` in the Supabase Dashboard, then schedule daily cleanup:

   ```sql
   select cron.schedule(
     'quiz-village-expired-data-cleanup',
     '15 3 * * *',
     'select public.cleanup_expired_quiz_data();'
   );
   ```

   Cleanup removes participants and their scores once the event end time plus the configured retention period has passed. Verify the scheduled job in the Supabase Cron dashboard before the event.

## Deploy Functions

```powershell
supabase functions deploy start-quiz
supabase functions deploy submit-quiz
supabase functions deploy leaderboard
```

The functions intentionally disable Supabase JWT verification because participants are unauthenticated. They use the server key internally, restrict browser origins, validate submissions, and compute scores on the server. The database tables and RPC functions deny direct access to `anon` and `authenticated` roles.

Before a public event, add a CAPTCHA or equivalent abuse control to `start-quiz` and review the public full-name display notice with the event owner. A public leaderboard necessarily reveals each participant's full name, score, rank, and submission time.

## Local Preview

For a complete local run with scoring and answer review, start the dependency-free local server:

```powershell
node dev-server.js
```

Then open `http://127.0.0.1:4173`. The server reads the ignored answer key from `supabase/functions/.env`, binds only to localhost, and keeps participant, score, and leaderboard records in memory. Stopping the process clears all local test records. The answer key is not sent to the browser. Opening `index.html` directly with `file://` still provides an ungraded explanation-only preview. A hosted page with incomplete Supabase configuration blocks quiz registration rather than silently saving personal information locally.