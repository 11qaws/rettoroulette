import { describe, expect, it } from 'vitest';

import { csvField } from './csv';

describe('csvField', () => {
  it('quotes ordinary CSV values and doubles embedded quotes', () => {
    expect(csvField('레또 "최고"')).toBe('"레또 ""최고"""');
  });

  it.each(['=1+1', '+SUM(A1:A2)', '-1+1', '@cmd', '  =HYPERLINK("x")'])(
    'neutralizes formula-like spreadsheet values: %s',
    (value) => {
      expect(csvField(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
    },
  );
});
