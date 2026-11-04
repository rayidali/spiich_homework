# Spiich Engineering Assignment: AI-Powered Accounting Platform

## Overview

Build a full-stack double-entry accounting platform with AI capabilities. The system should handle real bookkeeping (journal entries, a chart of accounts, financial reporting) and layer on AI features that make it genuinely useful: natural language transaction entry, automatic categorization, anomaly detection, and conversational financial insights.

**Submission Deadline**: 5 days from receipt

## What You're Building

A working accounting system where a user can manage their finances through both traditional forms and AI-assisted interactions. Think of it as a simplified QuickBooks with an AI copilot built in.

### Core Accounting Engine

**Double-Entry Bookkeeping.** Every transaction records equal debits and credits across accounts. The fundamental accounting equation (Assets = Liabilities + Equity) must always hold. A single "transaction" is a journal entry with two or more line items that must balance to zero.

**Chart of Accounts.** Users manage a tree of accounts organized by type: Assets, Liabilities, Equity, Revenue, and Expenses. Each account has a unique code (e.g., 1000 for Cash, 2000 for Accounts Payable), a name, and its type. The system should ship with a sensible default chart of accounts that a user can customize.

**Journal Entries.** The core data model. Each entry has a date, description, and two or more lines. Each line references an account and specifies either a debit or credit amount. The sum of debits must equal the sum of credits on every entry. Entries are immutable once posted. Corrections are made via reversing entries.

**Multi-Currency.** Accounts can hold balances in different currencies. Journal entries involving foreign currencies must record the exchange rate used. The system should be able to report balances converted to a base currency.

**Recurring Transactions.** Users can set up templates for transactions that repeat on a schedule (weekly, monthly, yearly). The system should automatically generate pending entries based on these schedules for users to review and post.

### Financial Reporting

The system must generate these standard reports:

- **Trial Balance**: All accounts with their debit/credit balances, proving the books balance
- **Income Statement (P&L)**: Revenue minus expenses for a given period
- **Balance Sheet**: Assets, liabilities, and equity at a point in time
- **Account Ledger**: Full transaction history for any single account with running balance

Reports should support date range filtering and be rendered in the UI.

### AI Features

**Natural Language Transaction Entry.** A chat-like input where users can type things like:
- "Paid $2,400 rent for March"
- "Received $15,000 from Acme Corp for invoice #1042"
- "Bought office supplies for $340 with the company credit card"

The system should parse these into proper double-entry journal entries, infer the correct accounts from the chart of accounts, and present the structured entry for the user to confirm before posting. Handle ambiguity by asking clarifying questions.

**Transaction Categorization.** When importing or creating transactions, the AI should suggest which accounts to debit/credit based on the transaction description and historical patterns. Over time, the suggestions should improve based on the user's corrections.

**Anomaly Detection.** Flag unusual transactions: amounts significantly different from historical patterns for that account, duplicate entries, entries that break typical patterns (e.g., rent suddenly doubling). Display these as alerts in the UI.

**Financial Insights Chat.** A conversational interface where users can ask questions about their financial data:
- "What were my top 5 expenses last month?"
- "How does this quarter's revenue compare to last quarter?"
- "Show me all transactions with Acme Corp"
- "What's my current cash position?"

The AI should query the actual database to answer these questions accurately, not hallucinate numbers.

### Frontend

Build a React application that serves as the primary interface. It should include:

- Dashboard with key financial metrics and recent activity
- Chart of accounts management (CRUD)
- Journal entry creation (both manual form and AI-assisted natural language)
- Transaction list with search, filtering, and pagination
- Financial report views (Trial Balance, P&L, Balance Sheet)
- Anomaly alerts display
- Financial insights chat interface
- Recurring transaction management

The UI should be well-designed. Clean, polished, and thoughtfully laid out. We care about visual design, usability, and information architecture.

### Technical Requirements

- **TypeScript** end-to-end (backend and frontend)
- **PostgreSQL** as the primary database with proper schema design and migrations
- **Docker Compose** setup so we can run the entire stack with a single command
- Some test coverage, enough to demonstrate you can write meaningful tests
- Proper error handling throughout
- API design that makes sense (REST or GraphQL, your choice)

### What We Evaluate

We're looking at how you architect a non-trivial system, make design decisions, and handle the complexity of real accounting rules combined with AI integration. We care about:

- **Data model design**, especially how you handle double-entry constraints at the database level
- **Correctness**: the books must always balance; financial data must be accurate
- **AI integration quality**: are the AI features genuinely useful or just bolted on?
- **Code organization**: can we navigate and understand the codebase?
- **Error handling**: what happens when things go wrong?
- **Testing**: can you write meaningful tests? We don't need full coverage, just evidence of good testing instincts
- **UI/UX design**: does it look good and feel intuitive?

We don't care about:
- Authentication (not required)
- Deployment configuration beyond Docker Compose
