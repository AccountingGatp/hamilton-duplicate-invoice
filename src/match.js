import { invoiceKey, key, looseInvoiceKey } from './values.js'

export const outcomes = {
  paid: 'Paid report match',
  open: 'Repeated unpaid invoice',
  review: 'Invoice details to review',
  bank: 'Bank amount to review',
  clear: 'No match found',
}

function indexBy(rows, getKey) {
  const index = new Map()
  for (const row of rows) {
    const id = getKey(row)
    if (!id) continue
    if (!index.has(id)) index.set(id, [])
    index.get(id).push(row)
  }
  return index
}

const scope = row => [key(row.vendor), key(row.property)]
const scoped = (row, ...parts) => JSON.stringify([...scope(row), ...parts])
const descriptionKey = value => key(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const numberIndex = row => looseInvoiceKey(row.number) ? scoped(row, looseInvoiceKey(row.number)) : null
const detailsIndex = row => row.total > 0 && row.date ? scoped(row, row.total, row.date) : null
const sameEntity = (a, b) => !a.entity || !b.entity || key(a.entity) === key(b.entity)
const sameNumber = (a, b) => invoiceKey(a.number) && invoiceKey(a.number) === invoiceKey(b.number)

export function compareInvoices(unpaid, paid, bankReports = []) {
  const ledger = [...paid, ...unpaid]
  const byNumber = indexBy(ledger, numberIndex)
  const byDetails = indexBy(ledger, detailsIndex)
  const bankEntries = bankReports.flatMap(report => report.rows.flatMap(transaction =>
    report.properties.map(property => ({ ...transaction, property }))))
  const byBankAmount = indexBy(bankEntries, row => JSON.stringify([key(row.property), row.amount]))

  return unpaid.map(invoice => {
    const evidence = []
    const identity = byNumber.get(numberIndex(invoice)) ?? []
    for (const other of identity) {
      if (invoice === other || !sameEntity(invoice, other)) continue
      const exact = sameNumber(invoice, other) && invoice.total === other.total
        && invoice.total > 0 && invoice.date === other.date
      const hasProperty = Boolean(key(invoice.property))
      if (exact && hasProperty && other.status === 'paid' && other.paid >= other.total && other.balance === 0) {
        evidence.push({ type: 'paid', reason: 'Same vendor, property, invoice number, date and total. Paid report shows a zero balance and full payment.', row: other })
      } else if (exact && hasProperty && other.status === 'unpaid') {
        evidence.push({ type: 'open', reason: 'Same vendor, property, invoice number, date and total on another unpaid row.', row: other })
      } else {
        let reason = sameNumber(invoice, other) ? 'Same invoice number' : 'Similar invoice number'
        const differences = []
        if (invoice.total !== other.total) differences.push('total differs')
        if (invoice.date !== other.date) differences.push('invoice date differs')
        if (!hasProperty) differences.push('property missing')
        if (other.status === 'paid' && (other.balance !== 0 || other.paid < other.total)) differences.push('full payment unresolved')
        if (differences.length) reason += ` (${differences.join(', ')})`
        evidence.push({ type: 'review', reason, row: other })
      }
    }
    const details = byDetails.get(detailsIndex(invoice)) ?? []
    for (const other of details) {
      if (other === invoice || identity.includes(other) || !sameEntity(invoice, other)) continue
      const description = descriptionKey(invoice.description)
      if (description.length >= 4 && description === descriptionKey(other.description)) {
        evidence.push({ type: 'review', reason: 'Same vendor, invoice date, total and description. Check the invoice numbers.', row: other })
      }
    }
    const bankChecked = Boolean(invoice.property) &&
      bankReports.some(report => report.start && report.properties.some(property => key(property) === key(invoice.property)))
    const targets = new Map()
    if (invoice.total > 0) targets.set(invoice.total, 'invoice total')
    if (invoice.balance > 0 && invoice.balance !== invoice.total) targets.set(invoice.balance, 'open balance')
    for (const [amount, field] of targets) {
      const transactions = byBankAmount.get(JSON.stringify([key(invoice.property), amount])) ?? []
      for (const row of transactions) {
        evidence.push({ type: 'bank', reason: `Bank withdrawal equals the ${field}. Verify the payee and reference.`, row })
      }
    }
    const type = ['paid', 'open', 'review', 'bank'].find(category => evidence.some(item => item.type === category)) ?? 'clear'
    return { invoice, evidence, type, bankChecked }
  })
}
