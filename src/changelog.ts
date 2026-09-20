// バージョン番号と更新履歴の骨組み。日付とバージョンだけを持ち、文章は
// src/locales/*.json 側に置く (「翻訳キーは src/locales の JSON で管理」に従う)。
//
// Vite にも DOM にも依存しないので rimOffset.ts / shareLink.ts と同じく
// node --test から素で読める。
//
// version++ / tagging / GitHub Release の手順は docs/RELEASE.md にある。触るのは 3 箇所
// だけ —— 下の CHANGELOG の先頭に 1 エントリ、package.json の "version"、そして両 locale の
// pages.changelog.releases に 1 節。バージョン番号が重複するのは前 2 箇所だけで、
// 食い違いは changelog.test.ts が落とす。

export interface ChangelogEntry {
  /** SemVer。 */
  version: string;
  /** ISO 8601 の日付 (YYYY-MM-DD)。表示もこの形のまま出す。 */
  date: string;
}

/**
 * 新しいものが先頭。表示順も配列の順そのまま。追記は先頭に 1 つ差し込むだけ。
 *
 * as const satisfies にしてあるのは CHANGELOG[0] を型のまま読むため
 * (App.tsx の SPOKE_COUNTS と同じ書き方)。
 */
export const CHANGELOG = [
  { version: '0.5.1', date: '2026-09-20' },
  { version: '0.5.0', date: '2026-09-09' },
  { version: '0.4.0', date: '2026-08-19' },
  { version: '0.3.0', date: '2026-08-14' },
  { version: '0.2.1', date: '2026-08-13' },
  { version: '0.2.0', date: '2026-08-13' },
  { version: '0.1.0', date: '2026-08-10' },
] as const satisfies readonly ChangelogEntry[];

/**
 * 画面に出すバージョン。履歴の先頭から起こすので、履歴と表示が食い違うことがない。
 * package.json の "version" との一致は changelog.test.ts が見張る。
 */
export const APP_VERSION = CHANGELOG[0].version;

/**
 * 翻訳キーに使うリリース識別子。'.' を '_' に置き換えるのが要点 —— i18next の
 * keySeparator が '.' なので、'0.1.0' をそのままキーにすると 3 階層のネストとして
 * 解釈され、pages.changelog.releases.0.1.0.notes を引けなくなる。
 */
export const releaseKey = (version: string): string => `v${version.replaceAll('.', '_')}`;

/** エントリの年。日付が ISO 8601 なので先頭 4 文字がそのまま年になる。 */
export const changelogYear = (entry: ChangelogEntry): string => entry.date.slice(0, 4);

/** 履歴に載っている年。新しい順。 */
export const changelogYears = (): string[] => [...new Set(CHANGELOG.map(changelogYear))];

/** その年のエントリ。無ければ空配列 —— 呼び出し側が「該当なし」を出す。 */
export const entriesForYear = (year: string): ChangelogEntry[] =>
  CHANGELOG.filter(entry => changelogYear(entry) === year);

/**
 * 「すべての更新履歴」が最初に見せる年。現在時刻ではなく履歴のいちばん新しい年を返す
 * —— 年が明けてまだその年のリリースが無いとき、時計を見ると空のページになる。
 * 時計に触らないのでユニットテストも素で書ける。
 */
export const newestChangelogYear = (): string => changelogYear(CHANGELOG[0]);
