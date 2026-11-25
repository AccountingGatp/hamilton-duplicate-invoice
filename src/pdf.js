import { getDocument } from 'pdfjs-dist'
import { cents, date, key, label } from './values.js'

const layouts = {
  paid: {
    left: 27, property: [87, 135], invoiceDate: [136, 193], description: [193, 327],
    ref: [327, 378], paymentDate: [378, 426], account: [426, 501],
    money: [[501, 580], [580, 644], [644, 708], [708, 780]],
  },
  unpaid: {
    left: 37, property: [92, 137], invoiceDate: [138, 191], description: [287, 420],
    state: [420, 478], money: [[600, 651], [651, 704], [704, 770]],
  },
}

function lines(items, width) {
  const scale = 792 / width
  const rows = []
  const points = items.filter(item => item.str?.trim()).map(item => ({
    text: label(item.str), x: item.transform[4] * scale,
    y: item.transform[5] * scale, font: item.fontName,
  })).sort((a, b) => b.y - a.y || a.x - b.x)
  for (const item of points) {
    if (!rows.length || Math.abs(rows.at(-1).y - item.y) > 1.5) rows.push({ y: item.y, items: [] })
    rows.at(-1).items.push(item)
  }
  return rows.map(row => {
    row.items.sort((a, b) => a.x - b.x)
    return { ...row, text: row.items.map(item => item.text).join(' ') }
  })
}

const read = (row, [left, right]) => row.items.filter(i => i.x >= left && i.x < right).map(i => i.text).join(' ')

export async function readInvoicePdf(data, source, status, onPage = () => {}, loadDocument = getDocument) {
  const report = loadDocument({ data, isEvalSupported: false, useSystemFonts: true })
  const layout = layouts[status]
  const paid = status === 'paid'
  const rows = []
  const warnings = []
  const totals = []
  let vendor = ''
  let headingFont
  let matchedTitle = false
  let finished = false
  let scope = ''
  let entity = ''
  try {
    const doc = await report.promise
    for (let pageIndex = 1; pageIndex <= doc.numPages && !finished; pageIndex++) {
      onPage(pageIndex, doc.numPages)
      const page = await doc.getPage(pageIndex)
      const info = await page.getTextContent()
      const pageRows = lines(info.items, page.getViewport({ scale: 1 }).width)
      const titleIndex = pageRows.findIndex(row => key(row.text) === `${status} invoices`)
      if (pageIndex === 1 && titleIndex < 0) {
        throw new Error(pageRows.length
          ? `Expected a ResMan ${status} invoice report. Select the correct export or use an invoice CSV.`
          : 'This PDF has no readable text. Export a text PDF or use an invoice CSV.')
      }
      if (titleIndex >= 0) matchedTitle = true
      const printed = pageRows.findIndex(row => /^Printed\b/i.test(row.text))
      if (printed < 0) {
        warnings.push(`Page ${pageIndex} has no report header. Its rows were skipped.`)
        continue
      }
      if (pageIndex === 1) {
        entity = pageRows[titleIndex - 1]?.text ?? ''
        scope = pageRows.slice(titleIndex + 1, printed).map(row => row.text).join(' ')
      }
      const body = pageRows.slice(printed + 1)
      const header = body.find(row => /\bDescription\b.*(?:Amount Paid|Balance)/i.test(row.text))
      headingFont = header?.items[0]?.font ?? headingFont
      const bodyStart = header ? body.indexOf(header) + 1 : 0
      let section = []
      function collectSection() {
        const candidates = section.filter(row => date(read(row, layout.invoiceDate)))
        for (const [index, line] of candidates.entries()) {
          const amounts = layout.money.map(range => cents(read(line, range)))
          if (amounts.some(value => value == null) || !vendor) {
            warnings.push(`Page ${pageIndex} has an invoice row without a readable vendor or amount.`)
            continue
          }
          const nearby = section.filter(row => {
            const distance = Math.abs(row.y - line.y)
            const previous = candidates[index - 1]
            const next = candidates[index + 1]
            return distance <= 24
              && (!previous || row.y < (line.y + previous.y) / 2)
              && (!next || row.y >= (line.y + next.y) / 2)
          })
          const number = nearby.map(row => read(row, [layout.left - 2, layout.property[0]])).filter(Boolean).join(' ')
          const desc = nearby.filter(row => !paid || row === line ||
            (!read(row, layout.invoiceDate) && !read(row, layout.money[0])))
          const payment = paid ? amounts[1] + amounts[2] : amounts[1]
          rows.push({
            status, source, entity, location: `Page ${pageIndex}`, vendor, number,
            property: read(line, layout.property), date: date(read(line, layout.invoiceDate)),
            total: amounts[0], paid: payment, balance: amounts.at(-1),
            description: desc.map(row => read(row, layout.description)).filter(Boolean).join(' '),
            state: paid ? '' : read(line, layout.state),
            paymentDate: paid ? date(read(line, layout.paymentDate)) : '',
            reference: paid ? nearby.map(row => read(row, layout.ref)).join('').trim() : '',
            account: paid ? read(line, layout.account) : '',
          })
        }
        section = []
      }
      for (const line of body.slice(bodyStart)) {
        const first = line.items[0]
        const left = Math.abs(first.x - layout.left) < 2
        if (left && /^(Pending (Payment|Deposit) Refunds|Prepaids)$/i.test(line.text)) {
          collectSection()
          finished = true
          break
        }
        if (/^©/.test(line.text)) continue
        const subtotal = left && /^(?:Invoice\(s\):\s*([\d,]+)|([\d,]+)\s+Invoice\(s\))/i.exec(line.text)
        if (subtotal) {
          collectSection()
          totals.push({
            count: Number((subtotal[1] ?? subtotal[2]).replaceAll(',', '')),
            amounts: layout.money.map(range => cents(read(line, range))),
          })
          vendor = ''
        } else if (left && first.font === headingFont && line.items.every(item => item.font === headingFont)) {
          collectSection()
          vendor = line.text
        } else if (left && /^Notice$/i.test(first.text)) {
          collectSection()
        } else {
          section.push(line)
        }
      }
      collectSection()
      page.cleanup()
    }
    if (!matchedTitle) throw new Error(`Could not locate the ${status} invoice report title.`)
    const reportTotal = totals.at(-1)
    const sum = field => rows.reduce((total, row) => total + row[field], 0)
    const expected = reportTotal?.amounts ?? []
    const payment = paid ? expected[1] + expected[2] : expected[1]
    if (!reportTotal || reportTotal.count !== rows.length || expected.some(amount => amount === null) ||
      expected[0] !== sum('total') || payment !== sum('paid') || expected.at(-1) !== sum('balance')) {
      warnings.push(reportTotal
        ? `Extracted ${rows.length} invoice rows, while the report ends with a count of ${reportTotal.count}. Count or amount does not tie to the report total. Review before relying on this comparison.`
        : 'The report total could not be located. Verify that all invoice rows were read.')
    }
    return { rows, warnings, source, status, scope, entity }
  } finally {
    await report.destroy()
  }
}
