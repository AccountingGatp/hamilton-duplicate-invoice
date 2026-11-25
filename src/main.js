import { GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { readInvoicePdf } from './pdf.js'
import { readBankCsv, readInvoiceCsv, toCsv } from './csv.js'
import { compareInvoices, outcomes } from './match.js'
import { key, label, money } from './values.js'
import './styles.css'

GlobalWorkerOptions.workerSrc = workerUrl

const $ = id => document.getElementById(id)
const pageSize = 30
let page = 0
let results = []

function element(tag, value, className) {
  const node = document.createElement(tag)
  if (value !== undefined) node.textContent = value
  if (className) node.className = className
  return node
}

$('add-bank').addEventListener('click', () => {
  const row = $('bank-row').content.firstElementChild.cloneNode(true)
  row.querySelector('button').addEventListener('click', () => {
    row.remove()
    $('add-bank').focus()
  })
  $('bank-files').append(row)
  row.querySelector('input').focus()
})

function status(message, error = false) {
  $('feedback').hidden = !message
  $('feedback').textContent = message
  $('feedback').classList.toggle('error', error)
}

async function readFile(file, seen, read) {
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).join(',')
    if (seen.has(digest)) throw new Error('This file matches another selected file. Remove the repeated export and run the check again.')
    seen.add(digest)
    return await read(data)
  } catch (error) {
    throw new Error(`${file.name} — ${error.message || 'The file could not be read.'}`)
  }
}

async function invoiceReport(file, type, seen) {
  return readFile(file, seen, async data => {
    const extension = file.name.split('.').at(-1).toLowerCase()
    if (extension === 'csv') return readInvoiceCsv(new TextDecoder().decode(data), file.name, type)
    if (extension === 'pdf') return readInvoicePdf(data, file.name, type, (current, total) =>
      status(`Reading ${file.name} · Page ${current} of ${total}`))
    throw new Error('Choose a PDF or CSV file.')
  })
}

$('checker').addEventListener('submit', async event => {
  event.preventDefault()
  const files = { unpaid: [...$('unpaid').files], paid: [...$('paid').files] }
  const accounts = [...$('bank-files').children].map(row => {
    const [file, properties] = row.querySelectorAll('input')
    return { file: file.files[0], properties: [...new Map(properties.value.split(/[,;\n]/)
      .map(label).filter(Boolean).map(value => [key(value), value])).values()] }
  })
  const inputs = $('checker').querySelectorAll('input, button')
  inputs.forEach(input => { input.disabled = true })
  $('results').hidden = true
  status('Reading invoice reports…')
  try {
    const seen = new Set()
    const reports = []
    for (const [type, selected] of Object.entries(files)) {
      for (const file of selected) reports.push(await invoiceReport(file, type, seen))
    }
    const bank = []
    for (const { file, properties } of accounts) {
      if (!properties.length) throw new Error('Enter at least one property code for each bank CSV.')
      status(`Reading ${file.name}…`)
      bank.push(await readFile(file, seen, data => readBankCsv(new TextDecoder().decode(data), file.name, properties)))
    }
    const unpaid = reports.filter(report => report.status === 'unpaid').flatMap(report => report.rows)
    const paid = reports.filter(report => report.status === 'paid').flatMap(report => report.rows)
    results = compareInvoices(unpaid, paid, bank)
    setupResults(reports, bank, paid.length)
    status('')
    $('results').hidden = false
    $('results-heading').focus()
  } catch (error) {
    status(error.message, true)
  } finally {
    inputs.forEach(input => { input.disabled = false })
  }
})

function setupResults(reports, bank, paidCount) {
  const flagged = results.filter(row => row.type !== 'clear').length
  const checked = results.filter(row => row.bankChecked).length
  const reviewCounts = [
    ['Unpaid invoices', results.length], ['Flagged for review', flagged],
    ['Paid invoices searched', paidCount], ['Mapped to bank activity', checked],
  ]
  $('totals').replaceChildren(...reviewCounts.map(([name, count]) => {
    const card = element('div', undefined, 'metric')
    card.append(element('strong', count.toLocaleString()), element('span', name))
    return card
  }))
  const warnings = [...reports, ...bank].flatMap(report =>
    report.warnings.map(warning => `${report.source} — ${warning}`))
  for (const type of ['paid', 'unpaid']) {
    const typed = reports.filter(report => report.status === type)
    if (typed.length > 1) warnings.push(`Multiple ${type} reports were supplied. Overlapping exports can show the same source invoice more than once.`)
  }
  const entities = new Set(reports.map(report => key(report.entity)).filter(Boolean))
  if (entities.size > 1) warnings.push('PDF reports show different entity names. Check that the files belong to the intended entity.')
  const missingProperty = results.filter(row => !row.invoice.property).length
  if (missingProperty) warnings.push(`${missingProperty} unpaid invoice(s) have no property code. Only the less specific invoice review rules can apply to those rows.`)
  $('warnings').hidden = !warnings.length
  $('warnings').open = Boolean(warnings.length)
  $('warnings').querySelector('summary').textContent = `${warnings.length} import or coverage note(s)`
  $('warnings').querySelector('ul').replaceChildren(...warnings.map(warning => element('li', warning)))
  const files = [
    ...reports.map(report => `${report.source} · ${report.rows.length} ${report.status} invoice rows${report.scope ? ' · ' + report.scope : ''}`),
    ...bank.map(report => `${report.source} · ${report.rows.length} withdrawals · ${report.properties.join(', ')} · ${report.start ? report.start + ' to ' + report.end : 'No activity dates'}`),
  ]
  $('sources').querySelector('ul').replaceChildren(...files.map(file => element('li', file)))
  $('coverage').textContent = bank.length
    ? 'Bank amounts are potential matches. Review the payment details and dates covered by each export. A no-match result only covers the files supplied.'
    : 'Invoice files only. A bank payment check requires a Chase activity CSV for the property.'
  $('download').disabled = results.length === 0
  $('filter').value = flagged ? 'flagged' : 'all'
  $('search').value = ''
  page = 0
  render()
}

function visibleRows() {
  const filter = $('filter').value
  const query = key($('search').value)
  return results.filter(({ invoice, type, evidence }) => {
    const show = filter === 'all' || (filter === 'flagged' && type !== 'clear') ||
      (filter === 'clear' && type === 'clear') || evidence.some(item => item.type === filter)
    return show && key([invoice.vendor, invoice.number, invoice.property].join(' ')).includes(query)
  })
}

function describeEvidence(item) {
  const row = item.row
  const parts = item.type === 'bank'
    ? [row.date, money(row.amount), row.description, row.reference && `Ref ${row.reference}`]
    : [row.number || 'Invoice number unavailable', row.date, money(row.total), row.description,
      row.paymentDate && `Paid ${row.paymentDate}`, row.account, row.reference && `Ref ${row.reference}`]
  return [...parts, row.source, row.location].filter(Boolean).join(' · ')
}

function reviewRow(result) {
  const { invoice, type, evidence, bankChecked } = result
  const row = element('tr')
  const identity = element('td')
  identity.append(element('strong', invoice.vendor), element('small', invoice.number || 'Invoice number unavailable'),
    element('small', `${invoice.source} · ${invoice.location}`))
  row.append(identity, ...[invoice.property || '—', invoice.date, money(invoice.total), money(invoice.balance)].map(value => element('td', value)))
  const review = element('td')
  review.append(element('span', outcomes[type], `badge ${type}`))
  if (evidence.length) {
    const details = element('details')
    details.append(element('summary', `View ${evidence.length} match(es)`))
    const list = element('ul')
    for (const item of evidence) {
      const entry = element('li')
      entry.append(element('strong', item.reason), element('small', describeEvidence(item)))
      list.append(entry)
    }
    details.append(list)
    review.append(details)
  }
  if (!bankChecked) review.append(element('small', 'Bank check unavailable'))
  row.append(review)
  return row
}

function render() {
  const filtered = visibleRows()
  const start = page * pageSize
  const visible = filtered.slice(start, start + pageSize)
  $('rows').replaceChildren(...visible.map(reviewRow))
  if (!visible.length) {
    const row = element('tr')
    const cell = element('td', 'No invoices in this view.')
    cell.colSpan = 6
    row.append(cell)
    $('rows').append(row)
  }
  $('page-info').textContent = filtered.length
    ? `${start + 1}–${start + visible.length} of ${filtered.length} invoices` : '0 invoices'
  $('prev').disabled = page <= 0
  $('next').disabled = start + pageSize >= filtered.length
}

for (const id of ['filter', 'search']) $(id).addEventListener('input', () => { page = 0; render() })
$('prev').addEventListener('click', () => { page--; render() })
$('next').addEventListener('click', () => { page++; render() })

$('download').addEventListener('click', () => {
  const asAmount = value => value == null ? '' : value / 100
  const records = results.flatMap(({ invoice, evidence, type, bankChecked }) => {
    const items = evidence.length ? evidence : [{}]
    return items.map(({ row: match, type: matchType, reason }) => ({
      'Review result': outcomes[type], 'Vendor': invoice.vendor, 'Invoice number': invoice.number,
      'Property': invoice.property, 'Invoice date': invoice.date, 'Invoice total': asAmount(invoice.total),
      'Open balance': asAmount(invoice.balance), 'Status': invoice.state, 'Invoice description': invoice.description,
      'Invoice file': invoice.source, 'Invoice record': invoice.location,
      'Bank data': bankChecked ? 'Mapped activity supplied' : 'Unavailable',
      'Evidence type': outcomes[matchType] ?? '', 'Reason': reason ?? '',
      'Matched invoice': match?.number ?? '', 'Matched invoice date': match?.total != null ? match.date : '',
      'Evidence amount': asAmount(match?.amount ?? match?.total),
      'Paid or posted date': match?.paymentDate || (matchType === 'bank' ? match.date : ''),
      'Reference': match?.reference ?? '', 'Bank account': match?.account ?? '',
      'Evidence description': match?.description ?? '', 'Evidence file': match?.source ?? '',
      'Evidence record': match?.location ?? '',
    }))
  })
  if (!records.length) return
  const url = URL.createObjectURL(new Blob([toCsv(records)], { type: 'text/csv;charset=utf-8' }))
  const link = element('a')
  link.href = url
  link.download = 'duplicate-invoice-review.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
