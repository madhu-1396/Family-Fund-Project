# Phase 14 Email Notification Fix

Only the email-notification path was changed.

1. `src/app.js`
   - Keeps the existing single `send-member-notification` Edge Function.
   - Displays the actual notification failure reason instead of hiding it behind a generic message.
   - No financial calculations, loan numbering, UI layout, styling, or CRUD behavior was changed.

2. `supabase/functions/send-member-notification/index.ts`
   - Reports which required configuration secret is missing.
   - Reports the email provider's rejection message when available.
   - Does not expose secret values.

3. `EMAIL_NOTIFICATIONS_SETUP.md`
   - Updated deployment/configuration instructions.

The email provider remains Resend. No provider was silently switched.
