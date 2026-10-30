# Accounting walkthrough

> Checkpoint updated 2026-10-29. This walkthrough applies to the current Daybook application. Its five-event example is a learning fixture, separate from the six-month Northstar Studio demo shown in the UI. The rename and redesign do not change the accounting results. See the [saved checkpoint](../CHECKPOINT.md).

Imagine you run a small design studio. The app is a carefully organized notebook of what your business owns, owes, earns, and spends. An account is a labeled bookkeeping bucket. A journal entry describes one event; its lines describe which buckets changed.

| Account type | Meaning                                    | Example                           | Increased by |
| ------------ | ------------------------------------------ | --------------------------------- | ------------ |
| Asset        | Something you own or a payment owed to you | Bank, accounts receivable         | Debit        |
| Liability    | Something you owe                          | Credit card payable               | Credit       |
| Equity       | The owners' claim on the business          | Owner capital, accumulated profit | Credit       |
| Revenue      | Value earned by delivering work            | Design services                   | Credit       |
| Expense      | A cost of running the business             | Rent, used office supplies        | Debit        |

Debit means the left column; credit means the right column. Their effect depends on the type of account. Every posted entry has at least two lines, with equal debit and credit totals in the base currency. [OpenStax explanation](https://openstax.org/books/principles-financial-accounting/pages/3-5-use-journal-entries-to-record-transactions-and-post-to-t-accounts).

## One month from start to finish

Assume no opening balances, sales tax or owner withdrawals. Supplies are used immediately. All amounts in this example are USD.

| Event                                       | Debit                       | Credit                      | Why                                                    |
| ------------------------------------------- | --------------------------- | --------------------------- | ------------------------------------------------------ |
| You invest $10,000                          | Bank $10,000                | Owner capital $10,000       | The business has money and an equal owner investment.  |
| You finish $15,000 of work and invoice Acme | Accounts receivable $15,000 | Service revenue $15,000     | You earned the money; Acme owes it to you.             |
| Acme pays the invoice                       | Bank $15,000                | Accounts receivable $15,000 | Money owed becomes cash. Revenue was already recorded. |
| You pay $2,400 rent                         | Rent expense $2,400         | Bank $2,400                 | A business cost increases; cash decreases.             |
| You buy and use $340 of supplies on a card  | Supplies expense $340       | Credit card payable $340    | You incur a cost and owe the card company.             |

After these events your bank holds $22,600. Your profit is $15,000 minus $2,400 minus $340, or $12,260. Cash and profit measure different things: the bank also contains your owner investment, and the card purchase has not been paid from the bank yet.

The balance sheet satisfies: **$22,600 assets = $340 liabilities + $22,260 equity**. Equity includes the $10,000 investment and $12,260 earned profit. Omitting that profit from equity is a common software bug.

## Four views of the same journal

| Report           | What it answers                                      | Result in the example                             |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Trial balance    | Do account debit balances equal credit balances?     | $25,340 on each side.                             |
| Income statement | How much did we earn after costs during this period? | $12,260 profit.                                   |
| Balance sheet    | What do we own and owe as of this date?              | $22,600 assets, $340 liabilities, $22,260 equity. |
| Account ledger   | How did one account reach its balance?               | Bank: $10,000 → $25,000 → $22,600.                |

The income statement measures activity between two dates. The balance sheet includes the entire history up to one date. A filtered ledger must include the balance from before its selected start date. A balanced trial balance proves arithmetic consistency; it does not prove that the chosen accounts were correct. [Financial statement relationships](https://openstax.org/books/principles-financial-accounting/pages/2-3-prepare-an-income-statement-statement-of-owners-equity-and-balance-sheet).

## Drafts and corrections

A draft is written in pencil. Posting makes it permanent. If $2,400 rent should have been $2,200, post a reversal that debits Bank $2,400 and credits Rent $2,400, then post the correct $2,200 entry. Keep all three events, with their actual posting dates and links. Deleting the original would hide what happened.

## Foreign currency

Suppose a customer pays €100 for newly earned work. At a recorded rate of $1.10 per euro, debit the EUR bank €100 ($110 base value) and credit USD service revenue $110. The entry balances in USD. Store the original amount, currency, rate, and base amount so a later rate change does not rewrite history. Automatic period-end revaluation is a separate accounting process. [IAS 21](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2022/issued/part-a/ias-21-the-effects-of-changes-in-foreign-exchange-rates.pdf?bypass=on).

## The AI's job

For “Paid $2,400 rent for March,” AI identifies a likely expense and payment account. It asks about missing dates or accounts, and prepares a structured draft. You review the draft. The regular posting engine validates it. AI cannot bypass the ledger rules.

For “What were my top expenses last month?”, AI chooses an approved database query. SQL computes the amounts. The answer displays the actual query results and links to the supporting records. A well-formed AI response still needs business validation; structured output alone does not guarantee correct accounting.
