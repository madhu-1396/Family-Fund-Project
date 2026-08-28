# Email Notifications — Phase 14

The application already uses one reusable notification email template for member-related fund changes:

- New loan / loan updates / loan removal
- New EMI repayment / repayment updates / repayment removal
- New contribution / contribution updates / contribution removal
- Member detail updates and role changes

## Important

The application code calls the Supabase Edge Function:

`send-member-notification`

The Edge Function sends the email through **Resend**.

If the application says that the financial transaction succeeded but the email could not be sent, the transaction itself is intentionally kept. The updated frontend now displays the actual notification error returned by the Edge Function so the remaining configuration problem can be identified without changing any financial logic.

## Deploy the Edge Function

From the `phase12` project folder:

```bash
supabase functions deploy send-member-notification
```

## Configure the required Supabase Edge Function secrets

```bash
supabase secrets set RESEND_API_KEY="YOUR_RESEND_API_KEY"
supabase secrets set RESEND_FROM_EMAIL="notifications@your-verified-domain.com"
supabase secrets set RESEND_FROM_NAME="Friends & Family Fund"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are provided by the Supabase runtime.

Do **not** put the Resend API key or Supabase service-role key in `src/app.js` or `index.html`.

## Verify the sender

The `RESEND_FROM_EMAIL` address must be permitted by your Resend account/domain configuration.

The recipient must also have a valid email address on the member's linked Supabase Auth account.

## Test

1. Deploy the Edge Function.
2. Configure the Resend secrets.
3. Sign in as Admin.
4. Create a test contribution or loan.
5. Confirm the database transaction succeeds.
6. Confirm the member receives the notification email.
7. If delivery fails, the application will now show the actual reason returned by the notification service.

## Automatic loan numbers

The automatic loan-number change is separate from email delivery. The database generates:

`L01 → L02 → L03 → ...`

Do not change the loan-number logic when troubleshooting email delivery.

## Safety

The financial transaction is not rolled back when email delivery fails. This prevents a temporary email-provider problem from deleting or undoing a valid contribution, loan, or repayment.
