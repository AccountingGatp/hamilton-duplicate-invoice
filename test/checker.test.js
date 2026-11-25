import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readBankCsv, readInvoiceCsv, toCsv } from '../src/csv.js'
import { compareInvoices } from '../src/match.js'

const headers = 'Vendor,Invoice Number,Property,Invoice Date,Invoice Total,Amount Paid,Balance,Description'
const read = (record, status = 'unpaid') => readInvoiceCsv(
  [headers, record].join('\n'), status + '.csv', status
).rows[0]

test('compares different date ranges and preserves invoice numbers and cents', () => {
  const unpaid = read('Example Vendor,001-91,North,11/8/2031,34.62,0,34.62,Part')
  const paid = read('example vendor,001 - 91,NORTH,2031-11-08,34.62,34.62,0,Part', 'paid')
  const [result] = compareInvoices([unpaid], [paid])
  assert.equal(result.type, 'paid')
  assert.equal(result.evidence[0].row.number, '001 - 91')
  assert.equal(unpaid.total, 3462)
  assert.equal(result.bankChecked, false)
})

test('different property, vendor or reporting entity limits invoice matches', () => {
  const unpaid = { ...read('Vendor,90,A,4/5/25,23.45,0,23.45,Service fee'), entity: 'Example I' }
  const paid = [
    read('Vendor,90,B,4/5/25,23.45,23.45,0,Service fee', 'paid'),
    read('Other Vendor,90,A,4/5/25,23.45,23.45,0,Service fee', 'paid'),
    { ...read('Vendor,90,A,4/5/25,23.45,23.45,0,Service fee', 'paid'), entity: 'Example II' },
  ]
  assert.equal(compareInvoices([unpaid], paid)[0].type, 'clear')
})

test('same invoice identity with changed total or payment balance remains for review', () => {
  const unpaid = read('Vendor,IS100,A,4/5/25,23.45,0,23.45,Service fee')
  const similar = read('Vendor,IS-100,A,4/5/25,20.45,20.45,0,Service fee', 'paid')
  const partial = read('Vendor,IS100,A,4/5/25,23.45,13.45,10,Service fee', 'paid')
  const [result] = compareInvoices([unpaid], [similar, partial])
  assert.equal(result.type, 'review')
  assert.equal(result.evidence.length, 2)
})

test('repeated unpaid rows and changed invoice numbers have distinct evidence', () => {
  const first = read('Vendor,001,South,8/4/24,25.00,0,25.00,Service call')
  const duplicate = { ...first }
  const similar = read('Vendor,002,South,8/4/24,25.00,0,25.00,Service call')
  const [result] = compareInvoices([first, duplicate, similar], [])
  assert.equal(result.type, 'open')
  assert.deepEqual(result.evidence.map(item => item.type), ['open', 'review'])
})

test('Chase signed amount checks use withdrawals and apply only to mapped properties', () => {
  const chase = [
    'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
    'DEBIT,03/16/2032,"PAYEE, ABA",-10.62,CHECK,300,0009',
    'CREDIT,03/17/2032,REFUND,10.62,DEPOSIT,310.62,',
    'DEBIT,03/18/2032,PAYEE,-1.00,CHECK,309.62,0010',
  ].join('\r\n')
  const bank = readBankCsv(chase, 'activity.csv', ['A'])
  const invoiceA = read('Vendor,888,A,3/1/32,12.62,2,10.62,Material')
  const invoiceB = { ...invoiceA, property: 'B' }
  const [a, b] = compareInvoices([invoiceA, invoiceB], [], [bank])
  assert.equal(bank.start, '2032-03-16')
  assert.equal(bank.end, '2032-03-18')
  assert.equal(a.type, 'bank')
  assert.equal(a.evidence[0].row.reference, '0009')
  assert.match(a.evidence[0].reason, /open balance/)
  assert.equal(a.evidence.length, 1)
  assert.equal(b.type, 'clear')
  assert.equal(b.bankChecked, false)
})

test('invalid CSV rows are reported and downloadable text is escaped', () => {
  const report = readInvoiceCsv([headers,
    'Vendor,X,North,2/30/25,99,0,99,Invalid',
    'Vendor,Y,North,2/28/25,99,0,99,Valid',
  ].join('\n'), 'unpaid.csv', 'unpaid')
  assert.equal(report.rows.length, 1)
  assert.equal(report.warnings.length, 1)
  assert.match(toCsv([{ Vendor: '=1+1' }]), /"'=1\+1"/)
})
