# Friends & Family Fund — Phase 3

A Supabase-connected test application for a private friends/family contribution and loan fund.

Test users:
- M001 — admin
- M002 — member
- M003 — member

Fund rule:
- ₹1,000 monthly contribution
- 1% monthly reducing-balance loan interest

Phase 3 adds the operational dashboard for members, contributions, loans, repayments, schedules and reports.


## Latest Phase 3 updates
- Loan Monthly Rate is selected as a percentage (1%-10%) instead of entering decimal values.
- Loan repayment schedules include automatic totals for EMI/repayment, interest, principal and closing balance.
- Total calculations use underlying unrounded values to avoid rounding discrepancies.


## Loan repayment / closure workflow
1. Admin opens **Repayments** and selects a member.
2. The app automatically finds that member's open loan.
3. Total repayment, principal component and interest component are calculated from the reducing-balance schedule.
4. Admin enters/selects the loan closure date and optional transaction reference.
5. Saving creates the repayment record and changes the loan status to `closed`, with `closed_at` saved in Supabase.
6. Because the member can read their loan record through RLS, the closed status/date is visible on that member's dashboard automatically.

**Important:** This closure action records the full scheduled loan repayment as one aggregate repayment. If you later want to record every monthly EMI separately, we should make a separate EMI-by-EMI payment workflow so the aggregate closure record is not duplicated.

## Real EMI Ledger
- Each new loan automatically generates one ledger row per EMI in `loan_installments`.
- Admin records EMIs one at a time; the next unpaid EMI is enforced.
- Each payment creates a `repayments` row linked to its installment.
- The final EMI automatically changes the loan status to `closed` and records `closed_at`.
- Members can view their own loan installment status through Supabase RLS.


## Individual Member Dashboard
The dashboard now shows fund-level Total Fund Collected, Borrowed Fund, Current Fund Balance, and logged-in member contribution/loan details. The Loan Calculator, Fund Rules, EMI ledger, repayments and loan closure workflow remain unchanged.


## Phase 5 — Global Fund Dashboard Metrics

Run `supabase/phase5_global_fund_metrics.sql` once in the Supabase SQL Editor. This creates the secure `get_global_fund_metrics()` RPC so the Fund Overview is calculated globally and shows the same totals to admins and all members, without weakening the existing member-level RLS policies.

Dashboard labels are now:
- Total Fund Collected by All Members
- Borrowed Fund By Members
- Current Fund Balance of Members

The three cards are highlighted with distinct colours on both admin and member dashboards.


## Phase 6 — Member Repayment Visibility Fix

The Repayments tab now has a member-only **My EMI Repayments** ledger. When Admin records an EMI, the corresponding installment is already marked `paid` by the Phase 4 transaction; the member UI now renders that same `loan_installments` ledger with EMI number, due date, opening balance, EMI, interest, principal, closing balance, status and paid date.

Run `supabase/phase6_member_repayment_visibility.sql` once in Supabase SQL Editor to ensure repayment transaction RLS allows Admin full access and each member read access only to repayments belonging to their own loan(s).

### Phase 6 testing
1. Run the Phase 6 SQL migration.
2. Login as Admin (M001) and record one EMI for M002's loan.
3. Confirm Admin sees the payment as recorded.
4. Sign out and login as M002.
5. Open **Repayments** and confirm the EMI row is visible with `paid` status and paid date.
6. Login as M003 and confirm M002's repayment ledger is not visible.

## Phase 9 — Admin Edit / Delete Controls
- Admins can edit/delete member records, contribution records, loans and recorded EMI repayments.
- Members do not see Edit/Delete actions.
- Database RPCs enforce the Admin-only rule independently of the frontend.
- Loan and repayment operations include ledger-safety checks so financial history is not silently corrupted.

## Phase 10 — Admin EMI Details + Report Separation

Apply `supabase/phase10_admin_all_emi_details.sql` in Supabase SQL Editor after the existing Phase 9 migrations.

This phase adds the Admin-only `admin_get_all_emi_details()` RPC used by the new **All EMI Details Recorded** tab.

Frontend changes:
- Removes the global **Recorded EMI Payments** table from Repayments.
- Adds **All EMI Details Recorded** after Reports for Admin only.
- Separates Admin Reports into **My Loan Details** and **Overall Member Loan Details** (excluding the Admin's own loans from the overall section).
- Removes duplicated member-name suffixes such as `M017-Praveen — Praveen` from display, showing `M017 — Praveen` instead.
- Keeps existing EMI payment/date functionality unchanged.
