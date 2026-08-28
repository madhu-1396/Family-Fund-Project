# Phase 15 — Interest Included in Current Fund Balance (v9)

Based on v7/v8. The existing dashboard UI is preserved exactly as three tiles.

## Dashboard tiles — unchanged

1. Total Fund Collected by All Members
2. Borrowed Fund By Members
3. Current Fund Balance of Members

There is **no Interest Accumulated tile**.

## Calculation

Current Fund Balance =

`Paid Contributions + Collected Loan Interest - Outstanding Loan Principal`

Collected loan interest comes from `repayments.interest_component`.

## Important v8 issue fixed

The previous v8 SQL attempted to change the return columns of an existing
PostgreSQL function using `CREATE OR REPLACE FUNCTION`. PostgreSQL does not
permit that kind of return-type change.

v9 therefore drops and recreates the same RPC with its original three return
fields, while calculating interest internally.

## Supabase

Run `supabase/phase5_global_fund_metrics.sql` once in the Supabase SQL Editor.

For the current test data, the 12 repayment interest components total
₹132.37, so with ₹3,000 paid contributions and ₹0 outstanding principal,
the Current Fund Balance should become **₹3,132.37**.

No loan, repayment, contribution, authentication, or other existing
application functionality is changed.
