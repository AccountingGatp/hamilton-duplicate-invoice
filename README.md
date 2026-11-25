# Duplicate Invoice Check

Upload unpaid invoice reports, paid invoice history, and optional Chase activity files. The app runs in the browser and produces a review table and downloadable CSV. It uses no portal connection, server-side upload, external API, or database. GitHub only needs the application source.

## Deploy from GitHub to Vercel

1. Unzip this package. Put the files inside its project folder at the root of a GitHub repository.
2. In Vercel, select **New Project** and import that repository.
3. Select the **Vite** framework preset. The included Vercel configuration uses `npm ci`, `npm run build`, and the `dist` output directory.
4. Use Node.js 22 or 24 and deploy. The app requires no environment variables.

For local use, run `npm ci` and `npm run dev`. Run `npm test` for the comparison tests or `npm run build` for the production bundle. Serve the app over HTTPS or localhost.

## Input files

| Upload | Supported input |
| --- | --- |
| Unpaid invoices | One or more text-based ResMan **Unpaid Invoices** PDFs of the supplied layout, or invoice CSVs |
| Paid invoices | One or more text-based ResMan **Paid Invoices** PDFs of the supplied layout, or invoice CSVs |
| Bank activity | Chase transaction activity CSVs. Assign each file its operating account's property code or comma-separated codes for a shared account. Chase **Posting Date**, **Description**, signed **Amount**, and optional **Check or Slip #** are supported. CSVs using a separate **Debit** column also work. |

The invoice CSV accepts **Vendor**, **Invoice Number**, **Invoice Date**, and **Invoice Total**. Add **Property** to enable property-scoped matches. Add **Description**, **Amount Paid**, **Previous Paid**, **Balance**, **Status**, **Payment Date**, **Bank Account**, and **Reference** when available. Use one row per invoice, U.S. or ISO dates and U.S. amounts. For a paid CSV with both payment amount and balance omitted, the app uses the paid file classification and treats its invoice totals as paid.

Individual invoice layouts and image-only PDFs require conversion to invoice CSV. The report parser reads invoice rows and checks their counts and amounts against the PDF's ending totals. It stops at the unpaid report's refund and prepaids sections. If the app shows an import warning, verify the relevant rows and report totals before using the results.

## Review rules

- **Paid report match** requires the same vendor, property, invoice number, date, and positive total, with full payment and zero balance in the paid file.
- **Repeated unpaid invoice** flags unpaid rows sharing those same fields. Use non-overlapping exports so a repeated source row does not get mistaken for a separate invoice.
- **Invoice details to review** includes matching or similarly formatted invoice numbers with differing fields, plus same-date, same-amount rows with matching descriptions. Vendor and property comparison ignores case and extra whitespace. Different PDF entity names keep those invoice reports from matching each other.
- **Bank amount to review** means a posted withdrawal in a mapped account equals the invoice total or open balance. The reviewer should verify the payee, date, and reference. This check uses all the dates provided in the CSV and looks for single withdrawals. Combined payments and split withdrawals may require manual review.
- **No match found** reflects the records supplied. Include paid history and bank activity for the period that may contain the original payment. Review **Files and coverage** to see invoice report scope and bank activity dates.

Search and filter the review on screen. The CSV includes all checked invoices and a separate row for each piece of matching evidence, with source filenames and page or CSV record references.
