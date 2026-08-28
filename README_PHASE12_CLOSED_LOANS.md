# Friends & Family Fund — Phase 12

## Closed Loans display fix

This phase updates the Admin Repayments → Closed Loans panel:

- Loan No
- Issued Amount
- Issued Date
- EMI Amount (final paid EMI)
- Principal (final paid EMI principal component)
- Interest (final paid EMI interest component)
- Closed Date (loan `closed_at` date)
- View

The Closed Loans list no longer shows blank EMI/date fields when the loan has recorded paid installments.

Clicking **View** opens only that selected loan's complete EMI ledger, including all paid EMIs and their paid dates, using the existing loan-specific ledger view.

Active Loans continue to use the existing Active Loans columns.
