import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

// ネイティブの `<input type="number">` のスピンボタンを押しっぱなしにしたときの刻みは、
// 1 段目が即座、2 段目まで 250ms、以降 50ms だった (Chromium 141 で実測)。
// 下の 2 つはそれを下敷きにしている。

// 1 段目を踏んでから繰り返しに入るまでの間。
//
// 詰めすぎると「1 回押したつもりが 2 段進む」が起き、空けすぎると長押しの効かない
// 部品に見える。ネイティブの 250ms より空けてあるのは、こちらのステッパーが
// タッチの的でもあるため —— 指で押して離すまでの時間はマウスのクリックより長く、
// ネイティブのスピンボタンにはそもそもタッチで押される道が無い。
const HOLD_DELAY_MS = 400;

// 繰り返しの間隔。ネイティブと同じ 50ms = 1 秒あたり 20 段。
//
// 押し続けるほど速くする加速は入れない。刻みが読めなくなって行き過ぎるうえ、
// この計算機の数値欄はどれも「打った値を数段ぶん寄せる」用途しかない ——
// 端から端まで走らせたい欄は 1 つも無い。
const REPEAT_INTERVAL_MS = 50;

/**
 * ボタンを押している間、同じ処理を繰り返す。返るものをそのまま `onPointerDown` に渡す。
 *
 * 1 段目は押し下げで即座に走らせる。ネイティブのスピンボタンと同じで、押した手応えを
 * 指を離すまで待たせない。
 *
 * 使う側は click をそのまま拾ってはいけない —— ここが押し下げで既に 1 段動かしているので、
 * 1 タップで 2 段進む。ポインタ由来でない click (支援技術やキーボードが合成したもの) だけを
 * 拾うこと。判別の仕方は NumberInput の handleVirtualClick に書いてある。
 *
 * @param step 1 段ぶんの処理。まだ動けたら true、動けなかったら false を返す。
 *             false を受けた時点で繰り返しを止める —— 上限や下限に着いた後も
 *             タイマーが回り続けるのを防ぐ
 */
export const useHoldRepeat = (
  step: () => boolean,
): ((event: ReactPointerEvent<HTMLElement>) => void) => {
  // 毎描画で作り直される関数を、ハンドラを作り直さずに最新へ差し替えるため
  // (useSwipeToClose の onCloseRef と同じ)
  const stepRef = useRef(step);

  useEffect(() => {
    stepRef.current = step;
  });

  const timerRef = useRef<number | undefined>(undefined);
  // 押している間だけ張る window のリスナーをまとめて外すためのもの。
  // 個別の removeEventListener と違い、外し忘れる引数の食い違いが起きない
  const listenersRef = useRef<AbortController | null>(null);

  // 止める。指を離したときも、端に着いたときも、アンマウントのときもここを通る
  const stop = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    listenersRef.current?.abort();
    listenersRef.current = null;
  }, []);

  // 押しっぱなしのまま消えたとき (ページ遷移など) の掃除
  useEffect(() => stop, [stop]);

  const start = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    // 右クリックと 2 本目以降の指は見ない
    if (!event.isPrimary || event.button !== 0) return;

    // 長押し中も入力欄のフォーカスを保つ。Chromium の長押しメニュー経由の
    // フォーカス移動は mousedown の抑止だけでは止まらない。
    event.preventDefault();

    // 前の押しがまだ畳まれていなければここで畳む。二重に回さないための保険
    stop();

    // 1 段目。ここで動けないなら繰り返す先も無いので、タイマーもリスナーも張らない
    if (!stepRef.current()) return;

    const controller = new AbortController();

    listenersRef.current = controller;

    // 押し終わりは window で受ける。ボタン自身に付けると、端に着いて disabled が
    // 立った瞬間にそのボタンがイベントを受けなくなり、pointerup が届かないまま
    // タイマーだけが残る。指が枠の外へ滑って離された場合も同じ。
    window.addEventListener('pointerup', stop, { signal: controller.signal });
    window.addEventListener('pointercancel', stop, { signal: controller.signal });

    // setInterval ではなく setTimeout を繋ぐ。1 回ぶんの処理が間隔より長引いても
    // 呼び出しが溜まらず、止める判断 (step が false) を毎回はさめる
    const schedule = (delay: number): void => {
      timerRef.current = window.setTimeout(() => {
        if (stepRef.current()) {
          schedule(REPEAT_INTERVAL_MS);
          return;
        }

        stop();
      }, delay);
    };

    schedule(HOLD_DELAY_MS);
  }, [stop]);

  return start;
};
