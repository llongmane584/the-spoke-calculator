import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

// 向きが決まったと見なす移動量。これ未満のうちは縦か横か判じない。
// useSwipeToClose と同じ値 —— 指の迷いの大きさはコントロールごとには変わらない
const SLOP_PX = 8;

type Axis = 'pending' | 'x';

interface SegmentedDragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * セグメントコントロールを、指を置いたまま左右になぞって選ぶ。
 *
 * 反映は指を離したときではなく、なぞっている最中。指の下が常に選択済みになるので、
 * 行き過ぎても離す前に戻せる —— 狭い画面で 1 セグメント 60px しかない「組み方」の
 * 3 つのコントロール (#177) では、狙って一発でタップするより確実になる。
 *
 * タップには触れない。横へ SLOP_PX 動いたと判じて初めてポインタを掴むので、
 * それまではネイティブ radio の click がそのまま値を決める。
 *
 * 受けるのはタッチとペンだけ。マウスは見ない —— デスクトップのクリックやテキスト選択に
 * 一切触れないため (useSwipeToClose と同じ理由)。
 *
 * 横のジェスチャーをブラウザに渡さないための `touch-action: pan-y` は呼び出し側が持つ
 * (SegmentedControl の `touch-pan-y`)。片方だけでは成立しない —— あれが無いと
 * Chromium が横スワイプをオーバースクロール操作として横取りし、ここのドラッグは
 * pointercancel で切られる。OS にジェスチャーを持っていかれたときも同じ道を通り、
 * 値はそこまでで確定する (掴む前なら何も起きない)。
 *
 * @param groupRef セグメントを直接の子として持つ要素
 * @param values セグメントの並び順の値。`groupRef` の子と 1 対 1 で対応する
 * @param selected 現在の値。なぞり始めた位置で同じ値を投げ直さないために見る
 * @param onSelect 指の下のセグメントが変わったときに呼ぶもの
 */
export const useSegmentedDrag = (
  groupRef: RefObject<HTMLElement | null>,
  values: readonly string[],
  selected: string,
  onSelect: (value: string) => void,
): SegmentedDragHandlers => {
  // 追っているポインタ。null は「誰も追っていない」
  const pointerIdRef = useRef<number | null>(null);
  const axisRef = useRef<Axis>('pending');
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  // 掴んだ時点の各セグメントの右端 (ビューポート座標)。なぞっている間はここだけを見る
  const edgesRef = useRef<number[]>([]);
  // 最後に伝えた値。同じ値を 1 フレームごとに投げ直さないため
  const lastValueRef = useRef<string | null>(null);

  const release = (): void => {
    pointerIdRef.current = null;
    axisRef.current = 'pending';
    edgesRef.current = [];
    lastValueRef.current = null;
  };

  const selectAt = (clientX: number): void => {
    const edges = edgesRef.current;
    // 右端を順に見て最初に超えなかったところが指の下。どの右端も超えていたら
    // 最後のセグメント —— 枠の外へ出た指は、いちばん近い端の値に貼り付く
    const found = edges.findIndex(edge => clientX < edge);
    const index = found === -1 ? edges.length - 1 : found;
    const next = values[index];

    if (next === undefined || next === lastValueRef.current) return;

    lastValueRef.current = next;
    onSelect(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (pointerIdRef.current !== null) return;
    if (event.pointerType === 'mouse' || !event.isPrimary) return;

    pointerIdRef.current = event.pointerId;
    axisRef.current = 'pending';
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerId !== pointerIdRef.current) return;

    const group = groupRef.current;

    if (group === null) return;

    if (axisRef.current === 'pending') {
      const rawX = event.clientX - startXRef.current;
      const rawY = event.clientY - startYRef.current;

      if (Math.abs(rawX) < SLOP_PX && Math.abs(rawY) < SLOP_PX) return;

      // 縦が勝ったら、このポインタは以後見ない。ページは縦に送るものなので、
      // 迷ったときはスクロールに譲る (同値も縦扱い)
      if (Math.abs(rawY) >= Math.abs(rawX)) {
        pointerIdRef.current = null;
        return;
      }

      axisRef.current = 'x';
      // 掴む。以後 pointerup / pointercancel は指が枠の外へ出ても必ずここへ来る。
      // タップを壊さないよう、掴むのは横と判じたこの時点まで遅らせている
      group.setPointerCapture(event.pointerId);
      // 並びは掴んだ瞬間に 1 度だけ読む。指の 1 フレームごとにレイアウトを読むと
      // 強制同期レイアウトになる (useDockMorph / useSwipeToClose と同じ方針)。
      // 縦スクロールが割り込んでも x の境界は動かないので、読み直す理由もない
      edgesRef.current = Array.from(group.children, child => child.getBoundingClientRect().right);
      lastValueRef.current = selected;
    }

    selectAt(event.clientX);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerId !== pointerIdRef.current) return;

    // 離した位置で確定する。直前の pointermove から動いていれば、そのぶんを拾う
    if (axisRef.current === 'x') selectAt(event.clientX);

    release();
  };

  // OS にジェスチャーを持っていかれた / 指が 2 本になった等。
  // なぞっている間に伝えた値はそのまま —— 指の下にあったものが選ばれている
  const onPointerCancel = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerId !== pointerIdRef.current) return;

    release();
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
};
