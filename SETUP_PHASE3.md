# Phase 3 setup

1. Keep your current Supabase schema and RLS policies.
2. In Supabase SQL Editor, run `supabase/phase3.sql` if the EMI ledger is not already installed.
3. Run your existing Phase 4 and Phase 5 migrations if they are not already installed.
4. Run `supabase/phase6_member_repayment_visibility.sql`.
5. Replace your local folder with this updated Phase 6 folder, or open it in VS Code.
6. Use Live Server to open `index.html`.
7. Test M001 (admin), M002, and M003.

### Important
The frontend uses your Supabase URL and publishable key. Never place a Supabase service-role/secret key in frontend JavaScript.

### Current features
- Role-aware dashboard
- Member list
- Contribution recording
- Loan creation
- 1% reducing-balance EMI calculation
- Loan repayment schedule
- Repayment recording with principal/interest split
- Fund report
- Admin-only write controls
- Member RLS for own-record viewing

### Testing workflow
1. Login M001 → confirm all 3 members are visible.
2. Create a ₹1,000 contribution for each member.
3. Create a test loan, e.g. ₹10,000 for M002 for 12 months at 1%.
4. Open its schedule and verify the EMI.
5. Record one repayment.
6. Login M002 → confirm only M002's records and EMI repayment ledger are visible.
7. Login M003 → confirm only M003's records are visible and M002's repayment ledger is not visible.

This is still a test application. Complete legal/accounting review and stronger production controls before real-money use.

### Phase 9 — Admin Edit / Delete Controls

Run `supabase/phase9_admin_crud.sql` once in the Supabase SQL Editor.

This adds Admin-only Edit/Delete operations for:
- Members
- Contributions
- Loans
- Recorded EMI repayments

Members never receive these edit/delete controls. The database RPCs also enforce the Admin check, so hiding the buttons is not the only security layer.

Important safeguards:
- The last Admin cannot be deleted or demoted.
- A logged-in Admin cannot delete their own member profile.
- Members with financial records cannot be deleted until those records are handled.
- Loans with recorded repayments cannot be deleted.
- Loan principal/rate/tenure/approval date cannot be changed after repayments exist because those values drive the EMI ledger.
- Deleting a repayment returns its linked EMI to Pending and reopens a loan if the deleted repayment was its final EMI.
