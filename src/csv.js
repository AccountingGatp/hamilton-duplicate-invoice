import Papa from 'papaparse'
import { cents, date, key, label } from './values.js'

const headerKey = value => key(value).replace(/[^a-z0-9]/g, '')
const aliases = {
  vendor: ['Vendor', 'Vendor Name', 'Supplier', 'Payee'],
  number: ['Invoice Number', 'Invoice No', 'Invoice #', 'Bill Number', 'Invoice', 'Bill #'],
  property: ['Property', 'Property Code', 'Property Location', 'Location'],
  invoiceDate: ['Invoice Date', 'Bill Date', 'Date'],
  total: ['Invoice Total', 'Invoice Amount', 'Total', 'Gross Amount', 'Amount'],
  paid: ['Amount Paid', 'Paid Amount'],
  previousPaid: ['Previous Paid'],
  balance: ['Balance', 'Amount Due', 'Open Balance', 'Outstanding Amount'],
  description: ['Description', 'Memo'],
  state: ['Status', 'Invoice Status'],
  paymentDate: ['Payment Date', 'Last Payment', 'Date Paid'],
  postingDate: ['Posting Date', 'Posted Date', 'Transaction Date', 'Date'],
  reference: ['Reference', 'Last Reference', 'Check or Slip #', 'Check Number'],
  account: ['Bank Account', 'Account'],
  bankAmount: ['Amount', 'Transaction Amount'],
  debit: ['Debit', 'Withdrawal', 'Withdrawals'],
}

function readTable(csv, required) {
  const parsed = Papa.parse(csv, { skipEmptyLines: 'greedy' })
  if (parsed.errors.length) throw new Error('CSV formatting error. Check for unmatched quotation marks or export the file again.')
  const headerIndex = parsed.data.findIndex((row, index) =>
    index < 30 && required.every(field => aliases[field].some(alias => row.map(headerKey).includes(headerKey(alias)))))
  if (headerIndex < 0) throw new Error(`Missing required CSV headers. Expected ${required.map(field => aliases[field][0]).join(', ')}.`)
  const headers = parsed.data[headerIndex].map(headerKey)
  const columns = Object.fromEntries(Object.entries(aliases).map(([field, options]) => [
    field, options.map(headerKey).map(alias => headers.indexOf(alias)).find(index => index >= 0),
  ]))
  return {
    rows: parsed.data.slice(headerIndex + 1),
    firstRecord: headerIndex + 2,
    column: (row, field) => label(row[columns[field]]),
    has: field => columns[field] !== undefined,
  }
}

export function readInvoiceCsv(csv, source, status) {
  const table = readTable(csv, ['vendor', 'number', 'invoiceDate', 'total'])
  const warnings = []
  const rows = []
  for (const [index, cells] of table.rows.entries()) {
    const location = `CSV record ${table.firstRecord + index}`
    const read = field => table.column(cells, field)
    const vendor = read('vendor')
    const invoiceDate = date(read('invoiceDate'))
    const total = cents(read('total'))
    if (!vendor || !invoiceDate || total === null) {
      warnings.push(`${location} was skipped because vendor, invoice date, or total was missing or invalid.`)
      continue
    }
    const balance = cents(read('balance'))
    const currentPaid = cents(read('paid'))
    const previousPaid = cents(read('previousPaid')) ?? 0
    const paid = currentPaid !== null ? currentPaid + previousPaid
      : balance !== null ? total - balance : status === 'paid' ? total : null
    rows.push({
      source, status, location, vendor, number: read('number'), property: read('property'),
      total, paid, balance: balance ?? (paid !== null ? total - paid : null),
      date: invoiceDate, description: read('description'), state: read('state'),
      paymentDate: date(read('paymentDate')), reference: read('reference'), account: read('account'),
    })
  }
  if (table.rows.length && !rows.length) throw new Error('The CSV contains records, but none could be read as invoices.')
  return { source, status, rows, warnings, scope: '', entity: '' }
}

export function readBankCsv(csv, source, properties) {
  const table = readTable(csv, ['postingDate', 'description'])
  const signed = table.has('bankAmount')
  if (!signed && !table.has('debit')) throw new Error('Bank CSV requires a signed Amount or a Debit column.')
  const rows = []
  const warnings = []
  const dates = []
  for (const [index, cells] of table.rows.entries()) {
    const location = `CSV record ${table.firstRecord + index}`
    const read = field => table.column(cells, field)
    const posted = date(read('postingDate'))
    if (!signed && posted && !read('debit')) {
      dates.push(posted)
      continue
    }
    const amount = cents(read(signed ? 'bankAmount' : 'debit'))
    if (!posted || amount === null) {
      warnings.push(`${location} was skipped because its posting date or amount was invalid.`)
      continue
    }
    dates.push(posted)
    if (signed ? amount >= 0 : amount === 0) continue
    rows.push({
      source, location, date: posted, amount: Math.abs(amount),
      description: read('description'), reference: read('reference'),
    })
  }
  if (table.rows.length && !dates.length) throw new Error('The CSV contains records, but no valid bank activity dates and amounts were found.')
  dates.sort()
  return { source, rows, warnings, properties, start: dates[0], end: dates.at(-1) }
}

export function toCsv(records) {
  return '\uFEFF' + Papa.unparse(records, { escapeFormulae: true })
}
