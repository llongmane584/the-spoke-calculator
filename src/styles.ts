// 共有するスタイル文字列。コンポーネントでないものを置く。
// eslint.config.js の reactRefresh.configs.vite はコンポーネントと非コンポーネントの
// 混在 export を警告するので、専用モジュールに分けている。
//
// 色は必ずセマンティックトークン (bg-surface, text-fg, border-line …) で書くこと。
// パレット直参照 (bg-slate-800 など) と dark: は使わない —— 色の決定は
// src/index.css のトークン層に集約されている。

import type { PointerEvent } from 'react';

/*
 * アイコン付きボタンの寸法は次の 2 段しかない。ここ以外で決めないこと (#110)。
 *
 * - 44 段 (min-h-11、アイコンだけなら w-11 の正方形) —— 枠を持つ操作ボタン。
 *   btnPrimary / btnSecondary / btnSecondaryIcon / btnDanger / btnAction。
 *   計算結果下のアクションバーがこの段で、アプリ全体の基準になっている
 * - 36 段 (min-h-9 min-w-9) —— 枠を持たないゴースト。btnGhost と ghostIconBox。
 *   モーダルの ×、ヘッダーのテーマ切替、保存済みの削除など
 *
 * ゴーストを 44 に上げて 1 段にはしない。ヘッダーの言語 select が min-h-9 + text-sm で
 * 一段小さく、そこだけボタンが 44 になると行が合わない。モーダルの見出し行も同じ。
 *
 * 中の glyph は段によらず btnIcon (20px)。箱の大小より glyph の不揃いのほうが
 * 「サイズがバラバラ」に見えるので、こちらは 1 種類に絞る。
 */

/**
 * アイコンボタンの中の glyph。20px に固定する。
 *
 * 16px のままにしてあるのは Toast の × とラベル横の ? の 2 つだけで、どちらも
 * 文字の行の中に居座るもの。理由は各コンポーネント側に書いてある。それ以外で
 * h-4 w-4 のアイコンをボタンに入れないこと。
 *
 * 見出しに添える装飾アイコンはボタンではないので、こちらではなく
 * sectionHeadingIcon を使う。
 */
export const btnIcon = 'h-5 w-5 shrink-0';

/**
 * 36 段のタップ領域だけを取り出したもの。色も角丸も padding も持たない。
 *
 * 色や角丸を btnGhost と別に持ちたいボタン (Toast の ×、ラベル横の ?) の土台。
 * btnGhost に rounded-full を後付けで重ねる手は使えない —— どちらが効くかは
 * 生成された CSS の順序が決めるので、そもそも同じ要素に載せない。
 *
 * 見た目のサイズを変えずにタップ領域だけ広げたいときは、これに負マージンを添えて
 * レイアウト上の占有を元に戻す (36 − 10×2 = 16 なので -m-2.5)。
 */
export const ghostIconBox = 'inline-flex min-h-9 min-w-9 items-center justify-center';

// 横 padding は持たない。ラベル付きは px-4、アイコンだけのものは正方形にしたいので、
// 幅の決め方は variant 側の裁量にする —— 同じ要素に px-4 と px-3 を重ねても、
// どちらが効くかは生成された CSS の順序が決めるのでクラスの後付けでは上書きできない。
const btnBase =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md py-2 font-medium transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ' +
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-subtle';

/** 主要動作。1 画面に 1 つを原則とする。 */
export const btnPrimary = `${btnBase} px-4 bg-accent text-on-accent hover:bg-accent-hover`;

/** 副次動作。塗りではなくアウトラインにして、primary との階層を保つ。 */
export const btnSecondary = `${btnBase} px-4 border border-line-strong bg-surface text-fg hover:bg-sunken`;

/**
 * アイコンだけの副次動作 (保存ダイアログの保存ボタンなど)。btnSecondary の横 padding を
 * 落として 44×44 の正方形にしたもの。ghost と違って枠を持つのは、入力欄の隣に並べたとき
 * 同じ border-line-strong の枠で行が揃うため。
 *
 * ラベルが見えないので、使う側は必ず aria-label で名前を与えること。
 */
export const btnSecondaryIcon = `${btnBase} w-11 border border-line-strong bg-surface text-fg hover:bg-sunken`;

/**
 * アイコンボタンや控えめなリンク的操作 (36 段)。
 *
 * px-2 を残すのはテキストを持つゴースト (保存済みの「読み込む」) のため。
 * アイコンだけなら px-2×2 + 20 = 36 でちょうど min-w-9 と一致するので、
 * 別に正方形版を持たなくてよい。
 */
export const btnGhost =
  `${ghostIconBox} gap-2 rounded-md px-2 font-medium transition-colors ` +
  'text-fg-muted hover:bg-sunken hover:text-fg ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** 破壊的動作。 */
export const btnDanger = `${btnBase} px-4 bg-danger text-on-danger hover:bg-danger-hover`;

/**
 * 計算結果の下に並ぶアクションバーの 1 つ。5 つを均等割りするので btnBase とは
 * 別に持つ:
 *
 * - 横 padding を持たない (px-1)。幅は grid が決めるので、px-4 を残すと
 *   375px 幅で中身のほうが先に潰れる
 * - 5 つとも同格 (btnSecondary と同じ枠付き・塗りなし)。ここに主要動作の塗りを
 *   混ぜない —— 主要動作は「1 画面に 1 つ」で、それは各ダイアログの中にある
 * - relative は保存件数バッジの土台
 *
 * ラベルは狭い画面では sr-only にして隠す。aria-label で別に名前を与えるのでは
 * なく同じ文字列を隠す —— 見えているラベルと読み上げ名が食い違わない。
 */
export const btnAction =
  'relative inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-1 py-2 ' +
  'border border-line-strong bg-surface text-xs font-medium text-fg transition-colors hover:bg-sunken ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ' +
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-subtle disabled:hover:bg-sunken';

/**
 * CSS customizable select (`appearance: base-select`) が使えるか。
 * クラス文字列とマークアップの両方をこの 1 つの値で切り替える —— nativeSelect の
 * `appearance-none` は base-select を打ち消すので、CSS のカスケード順に賭けず
 * そもそも同じ要素に載せない。レンダリング中に変わらないのでモジュール定数でよい。
 */
export const supportsBaseSelect =
  typeof CSS !== 'undefined' && CSS.supports('appearance', 'base-select');

/**
 * 開いているピッカーを、トリガーの再タップで閉じるための保険。
 * customizable select を使う select には必ず onPointerDown で付けること
 * (スタイルではないがこのファイルに置く —— supportsBaseSelect の分岐と
 * 必ず対で使うもので、離すと片方だけ付け忘れる)。
 *
 * Chrome の customizable select は、開いた状態でトリガーを叩いたとき
 * タッチだと何も起きない (Chrome 151 で確認)。素の
 * `appearance: base-select` だけを持つ select でも再現するので、
 * このアプリの CSS・マークアップ・画面幅とは無関係なブラウザ側の穴。
 *
 * pointerdown の既定動作を止めるとポップオーバーの light-dismiss が走り、
 * トリガーを叩いても素直に閉じるようになる。
 *
 * ここまでが効くのは Chrome だけ。WebKit では空振りする
 * (Playwright の WebKit 26.5 + iPhone 15 で実測。実 Safari ではない):
 *
 * - 再タップの pointerdown は届き `preventDefault()` も通る (document で
 *   拾った defaultPrevented が true) が、ピッカーは開いたまま。
 *   「既定動作の抑止 → light-dismiss」という連鎖を WebKit は持たない。
 * - 代わりに足せる経路も無い。`hidePicker()` 相当は存在せず
 *   ('hidePicker' in HTMLSelectElement.prototype は Chrome も WebKit も false)、
 *   `blur()` は効かず (開いている間 activeElement は既に option)、
 *   touchstart の抑止も空振り、mousedown はタッチでは発火しない。
 *
 * だから WebKit 向けの分岐は入れていない。合成キーイベントのような
 * 「閉じたように見せる」手も入れない。WebKit で閉じる手段はピッカーの外を
 * タップすることと Escape (どちらも実測)。その「外」を残しているのが
 * index.css の ::picker(select) の max-height なので、あれを緩めると
 * WebKit では本当に閉じられなくなる。
 *
 * base-select 非対応のブラウザには、supportsBaseSelect の分岐でこのハンドラが
 * そもそも付かない。そこに出るのは OS のネイティブメニューで、位置も閉出も
 * OS のもの —— トリガーに重なって再タップできないのも、アプリからは動かせない
 * そちら側の話 (#88 / #91)。
 *
 * iOS Safari は 26.6 の実機でも `CSS.supports('appearance','base-select')` が
 * false で、こちらの経路に落ちる (実機で実測)。Playwright の WebKit 26.5
 * デスクトップビルドは true を返すので、あれを iOS の代用にはできない。
 * なお同じ実機の UA は `CPU iPhone OS 18_7` と名乗る —— OS トークンは実際の
 * バージョンと一致しない。判定は必ず CSS.supports で行うこと。
 *
 * ポインタの種類では分けない。閉じるという結果は変わらず、
 * 「マウスなら大丈夫」を前提にした分岐は入力手段が混ざる端末
 * (タッチ対応ノート PC など) で穴になる。
 *
 * option の上では止めないこと —— 止めると選択そのものが効かなくなる。
 * ピッカーの中身は select の子なので、イベントはここまで上がってくる。
 * optgroup の見出しとピッカーの余白も同じくここへ来る (前者は optgroup、
 * 後者は select が target) が、こちらは止めても閉じない —— light-dismiss は
 * ピッカーの外を叩いたときだけ走るため。Chrome で実測して確認済み。
 */
export const dismissOpenPicker = (event: PointerEvent<HTMLSelectElement>) => {
  if ((event.target as Element).closest('option') !== null) return;
  if (event.currentTarget.matches(':open')) {
    event.preventDefault();
  }
};

/**
 * 数値入力欄。右端にステッパーを重ねるぶんの余白 (pr-20) を最初から持つ。
 *
 * ステッパーは欄の外に生やさない。欄の左右にボタンを置くと、行の幅を 3 つで
 * 分け合うことになって入力欄そのものが痩せ、フォームの縦の線も崩れる。
 * ボックスの外形は据え置いて、中の余白にだけ寝かせる。
 *
 * ステッパーはフォーカス中しか出ないが、余白は出したり引っ込めたりしない。
 * フォーカスのたびに右 padding が動くと、値のほうが動いていないのに欄の中で
 * 文字の折り返し位置が変わる。空欄のプレースホルダーが一番長い欄
 * (ERD の "Effective Rim Diameter") でも pr-20 のまま収まることは実測済み。
 */
export const getNumberInputClassName = (hasError: boolean, className?: string): string => (
  [
    'w-full py-2 pl-3 pr-20 border rounded-md bg-surface text-fg tabular-nums placeholder:text-fg-subtle transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
    hasError
      ? 'border-danger-line bg-danger-soft focus-visible:outline-danger'
      : 'border-line-strong focus-visible:outline-focus',
    className || '',
  ].join(' ')
);

/**
 * 数値入力欄の中に寝かせるステッパー。36 段のゴースト。
 *
 * btnGhost をそのまま使わないのは、欄の中では文字と同じ面に載るため
 * 既定の text-fg-muted では値と張り合ってしまうから。一段落とした
 * text-fg-subtle から始めて、触れたときだけ前へ出す。
 *
 * touch-none と select-none は長押しの連続増減 (useHoldRepeat) のためのもので、
 * 見た目には効かない:
 *
 * - touch-none … これが無いと、押している指がスクロールの判定幅ぶん (数 px) 動いた
 *   だけでブラウザが縦パンと解釈し、pointercancel で繰り返しが切られる。押したまま
 *   指が微動するのは長押しでは普通に起きる。36px の的なのでここを掴んでスクロール
 *   できなくなる不利益は無く、欄の残りはどこでも今までどおり掴める
 * - select-none … 長押しでの文字選択とロングタップメニューを抑える
 */
export const stepperGhost =
  `${ghostIconBox} rounded-md touch-none select-none ` +
  'text-fg-subtle transition-colors hover:bg-sunken hover:text-fg ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ' +
  'disabled:pointer-events-none disabled:text-fg-subtle/40';

const selectBase =
  'w-full min-h-11 rounded-md border border-line-strong bg-surface py-2 pl-3 text-fg ' +
  'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

// appearance-none はドロップダウンのポップアップまでは変えられない。
// ポップアップ側は index.css の base 層にある color-scheme が担当する。
// pr-9 は重ねる ChevronDown のぶんの余白。
export const nativeSelect = `${selectBase} appearance-none pr-9`;

/**
 * CSS customizable select (`appearance: base-select`) が使えるときの select。
 * ポップアップまで自前で描けるので、重ねる ChevronDown も appearance-none も要らない
 * —— むしろ appearance-none は base-select を打ち消すので入れてはいけない。
 * 実際の見た目は index.css の `@supports (appearance: base-select)` ブロックが持つ。
 */
export const customizableSelect = `${selectBase} pr-3`;

// 見出し行に添える chip 型の select。入力欄ではなく「ここを埋める材料を選ぶ」操作
// なので、フルワイドの枠付きフィールドにはしない。丸いピルにして一段引かせる。
//
// 幅は中身ではなく外側の枠が決める (w-full)。選んだプリセット名の長さでチップが
// 伸び縮みすると、見出し行に収まらなくなった瞬間に折り返して行数が変わり、
// 選択のたびにレイアウトが跳ねる。溢れた名前は省略記号に落とす。
const chipBase =
  'flex w-full min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-3 ' +
  'text-sm text-fg-muted transition-colors hover:bg-sunken hover:text-fg ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export const nativeSelectChip = `${chipBase} appearance-none pr-8`;
export const customizableSelectChip = `${chipBase} pr-3`;

/** ネイティブ select に重ねる ChevronDown 用。pointer-events-none が無いとクリックを食う。 */
export const selectChevron =
  'pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle';

/** グループを持たない単独の見出しラベル (保存名の入力欄など)。 */
export const sectionHeading = 'mb-3 flex items-center gap-2 text-sm font-semibold text-fg';

/** sectionHeading に添えるアイコン。 */
export const sectionHeadingIcon = 'h-4 w-4 shrink-0 text-accent';

/** グループの中に置くフィールドラベル。見出しと張り合わないよう一段弱くする。 */
export const fieldLabel = 'mb-1 block text-sm font-medium text-fg-muted';

// 本文中のリンク。#118 の情報ページで初めて必要になった。
//
// 下線は消さない —— 色だけで区別すると WCAG 1.4.1 (色に頼らない) に落ちる。本文の
// text-fg に対して accent-ink は明るさが近く、ダークでもライトでも色差だけでは弱い。
// rounded-sm はフォーカスリングのため。下線付きの文字列に角の無いリングが付くと、
// 文字の下端とリングの下辺が重なって二重線に見える。
export const link =
  'rounded-sm text-accent-ink underline decoration-1 underline-offset-2 ' +
  'transition-colors hover:text-accent-hover ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

// メニュードロワーの 1 行。行そのものがリンクなので、44 の当たり判定 (min-h-11) を持たせる。
//
// -mx-3 のリストに置く前提。全幅の区切り線付きの行 (-mx-5) にはしない ——
// ドロワーの本文は overflow-y-auto で、overflow-y を付けると overflow-x も auto に
// なるため、枠の縁に置いた行の outline-offset-2 が切られる。
export const menuRow =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-base font-medium ' +
  'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
