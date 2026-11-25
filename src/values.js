export const label = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
export const key = value => label(value).toLowerCase()
export const invoiceKey = value => key(value).replace(/\s*([./-])\s*/g, '$1')
export const looseInvoiceKey = value => invoiceKey(value).replace(/[\s./-]+/g, '')

export function date(value) {
  const input = label(value)
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(input)
  if (!iso && !us) return ''
  const [year, month, day] = (iso ? iso.slice(1) : [us[3], us[1], us[2]]).map(Number)
  const fullYear = year < 100 ? year + (year < 70 ? 2000 : 1900) : year
  const valueDate = new Date(Date.UTC(fullYear, month - 1, day))
  if (valueDate.getUTCMonth() !== month - 1 || valueDate.getUTCDate() !== day) return ''
  return valueDate.toISOString().slice(0, 10)
}

export function cents(value) {
  const input = label(value).replace(/[$\s]/g, '')
  const normalized = input.replace(/^\((.*)\)$/, '-$1')
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(normalized)) return null
  const amount = Math.round(Number(normalized.replaceAll(',', '')) * 100)
  return Number.isSafeInteger(amount) ? amount : null
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const money = amount => amount == null ? '—' : usd.format(amount / 100)
