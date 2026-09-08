import { useRef } from 'react'
import { useSegmentedDrag } from '../hooks/useSegmentedDrag'

export interface SegmentedOption {
  value: string
  /** セグメントに描画する短いラベル */
  label: string
  /** label が略記のとき、支援技術に読ませる完全なテキスト */
  ariaLabel?: string
}

interface SegmentedControlProps {
  /** radio group 名。グループごとに一意でなければならない */
  name: string
  /** 可視ラベル要素の id */
  labelledBy: string
  /** '' は未選択 */
  value: string
  options: SegmentedOption[]
  onChange: (value: string) => void
  onBlur?: () => void
  invalid?: boolean
  describedBy?: string
}

/**
 * 少数の選択肢から 1 つを選ぶためのセグメントコントロール。
 *
 * 実装は role="radiogroup" + 視覚的に隠したネイティブ <input type="radio">。
 * ネイティブ radio なら roving tabindex（グループ全体で 1 タブストップ）、
 * 矢印キーでのラップ付き選択、aria-checked、未選択状態、フォームコントロール
 * セマンティクスが、すべての AT / ブラウザの組み合わせで無償かつ正しく手に入る。
 * role="radio" を手書きして keydown を自前で処理すると、これらを全部
 * 再実装することになり、誰も気づかないバグが最も出やすい箇所になる。
 *
 * Home / End は意図的に実装していない。ARIA APG の radiogroup パターンは
 * 要求しておらず、そのためだけに keydown ハンドラを足すと本設計が避けている
 * リスクを呼び戻すため。「未実装のバグ」ではないので直さないこと。
 *
 * タップに加えて、指を置いたまま左右になぞっても選べる (useSegmentedDrag)。
 * 狭い画面では 1 セグメントが 60px 前後しかなく、狙って一発でタップするのは細かい。
 * なぞっている間は指の下が常に選択済みになるので、行き過ぎても離す前に戻せる。
 *
 * 見た目は枠 + セグメント間の仕切り線 + 選択セグメントの塗り。隣接する
 * NumberInput と同じ border-line-strong の枠を持たせて、同じ「入力部品」として
 * 読めるようにしている。沈んだトラックの上にチップが乗る iOS 風の意匠は、
 * 操作可能に見えないうえ、ダークで surface と sunken の明度差が縮むと
 * 境界がほぼ消えるため採らない。
 */
export function SegmentedControl({
  name,
  labelledBy,
  value,
  options,
  onChange,
  onBlur,
  invalid = false,
  describedBy,
}: SegmentedControlProps) {
  const dividerClass = invalid ? 'border-danger-line' : 'border-line-strong'
  const groupRef = useRef<HTMLDivElement>(null)
  const dragHandlers = useSegmentedDrag(
    groupRef,
    options.map(option => option.value),
    value,
    onChange,
  )

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onBlur={onBlur}
      {...dragHandlers}
      // max-w-sm が無いと広いビューポートで 1 セグメントが 180px 近くまで
      // 間延びする。384px 上限なら 4 分割で 96px、5 分割で 77px に収まる。
      //
      // touch-pan-y —— 横のジェスチャーはこちらで受ける。これが無いと Chromium が
      // 横スワイプをオーバースクロール操作として横取りし、なぞりが pointercancel で
      // 切られる。子孫には掛けない。中にスクロールコンテナが無いので touch-action の
      // 探索はここまで遡る (ドロワーが `*` を要したのは、中の nav が自前のスクロール
      // コンテナで探索がそこで止まっていたため)
      className={[
        'flex w-full max-w-sm touch-pan-y overflow-hidden rounded-md border transition-colors',
        invalid ? 'border-danger-line bg-danger-soft' : 'border-line-strong bg-surface',
      ].join(' ')}
    >
      {options.map((option, index) => (
        <label key={option.value} className="flex flex-1">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            aria-label={option.ariaLabel}
            className="peer sr-only"
          />
          <span
            className={[
              'flex min-h-11 flex-1 items-center justify-center text-sm tabular-nums',
              'text-fg-muted transition-colors hover:bg-sunken',
              'peer-checked:bg-accent peer-checked:text-on-accent',
              'peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-focus',
              index === options.length - 1 ? '' : `border-r ${dividerClass}`,
            ].join(' ')}
          >
            {option.label}
          </span>
        </label>
      ))}
    </div>
  )
}
