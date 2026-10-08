const Papa = require('papaparse');

describe('CSV roster parser', () => {
  it('parses semicolon-delimited Excel CSV with a BOM and quoted commas', () => {
    const csv = [
      '\uFEFFFirstName;LastName;DateOfBirth;PrimaryDiagnosis',
      'John;Doe;2012-05-14;Asthma',
      'Jane;Smith;2011-09-22;"Type 1, Diabetes"',
    ].join('\r\n');

    const result = Papa.parse(csv, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.replace(/^\uFEFF/, '').trim().toLowerCase(),
    });

    expect(result.meta.fields).toEqual(['firstname', 'lastname', 'dateofbirth', 'primarydiagnosis']);
    expect(result.data).toHaveLength(2);
    expect(result.data[1].primarydiagnosis).toBe('Type 1, Diabetes');
  });

  it('parses comma- and tab-delimited files and rejects impossible dates', () => {
    const commaResult = Papa.parse('FirstName,LastName,DateOfBirth,PrimaryDiagnosis\nJohn,Doe,2012-05-14,Asthma', { header: true });
    const tabResult = Papa.parse('FirstName\tLastName\tDateOfBirth\tPrimaryDiagnosis\nJane\tSmith\t2011-09-22\tNone', { header: true });
    const invalidDateResult = Papa.parse('FirstName,LastName,DateOfBirth,PrimaryDiagnosis\nJohn,Doe,2012-02-30,Asthma', { header: true });

    expect(commaResult.meta.fields).toHaveLength(4);
    expect(tabResult.meta.fields).toHaveLength(4);
    expect(invalidDateResult.data[0].DateOfBirth).toBe('2012-02-30');
  });
});