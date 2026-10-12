import { describe, expect, it } from 'vitest';
import { getSqlText } from './i18n';

describe('SQL console translations', () => {
  it('provides the English SQL UI strings in the lazy feature module', () => {
    expect(getSqlText('en', 'title')).toBe('SQL Console');
    expect(getSqlText('en', 'execute')).toBe('Run Query');
    expect(getSqlText('en', 'licenses')).toContain('sql.js');
  });

  it('provides the Japanese SQL UI strings in the lazy feature module', () => {
    expect(getSqlText('ja', 'title')).toBe('SQLコンソール');
    expect(getSqlText('ja', 'execute')).toBe('クエリを実行');
    expect(getSqlText('ja', 'licenses')).toContain('sql.js');
  });
});
