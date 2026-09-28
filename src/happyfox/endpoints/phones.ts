export interface PhoneInput {
  number: string;
  type: string;
  is_primary?: boolean;
  id?: number;
}

// The API takes short codes, not the full words the tools accept
const PHONE_TYPE_CODES: Record<string, string> = {
  'mobile': 'mo',
  'work': 'w',
  'main': 'm',
  'home': 'h',
  'other': 'o'
};

// Only updateContact echoes ids back; create paths must not send them.
export function formatPhones(phones: PhoneInput[], includeId = false): any[] {
  return phones.map((phone, index) => {
    const formatted: any = {
      type: PHONE_TYPE_CODES[phone.type.toLowerCase()] || 'o',
      number: phone.number,
      is_primary: phone.is_primary ?? (index === 0)
    };
    if (includeId && phone.id) formatted.id = phone.id;
    return formatted;
  });
}
