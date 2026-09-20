import { useEffect, useRef } from 'react';
import type { ChangeEvent, CompositionEvent, KeyboardEvent, MouseEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHoldRepeat } from '../hooks/useHoldRepeat';
import { btnIcon, getNumberInputClassName, stepperGhost } from '../styles';
import {
  canStepNumericText,
  formatNumericText,
  sanitizeNumericText,
  stepNumericText,
} from '../numberInput';

interface NumberInputProps {
  id: string;
  /** 可視ラベルの文字列。ステッパーの読み上げ名に使う */
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  step: number;
  min?: number;
  max?: number;
  error?: string;
  describedBy?: string;
  placeholder?: string;
  className?: string;
}

/**
 * 数値をひとつ受ける欄。増減のステッパーを欄の内側の右端に寝かせてある。
 *
 * ステッパーを欄の外 (左右) に生やしてはいけない。行の幅を 3 つで分け合うことになって
 * 入力欄そのものが痩せ、7 欄ぶん並んだときにフォームが枠だらけになる。値を見るための
 * 面積を削って操作のための枠を増やすのは、入力体験としては差し引きで悪化する。
 * ボックスの外形は今のまま据え置き、右端の余白 (pr-20) にだけ収める。
 *
 * 出るのはフォーカス中の欄だけ。7 欄ぶんのグリフが常に並んでいると、値そのものより
 * 操作部品のほうが目に付く。触っていない欄はステッパーを入れる前と 1px も変わらない。
 *
 * type="number" ではなく type="text" + inputMode で組んである。number には
 * この計算機では避けられない穴が 3 つあるため:
 *
 * - 値が「妥当な浮動小数点数」でなくなった瞬間、HTML の value sanitization が
 *   value を空文字にする。貼り付けで不正な文字列が入ると、入力済みの値が無言で消える
 * - フォーカス中のホイールスクロールで値が変わる (Chrome / Firefox)。
 *   縦に長いフォームなので実際に起きる
 * - 小数点キーがソフトキーボードに出るかがブラウザ任せ。リムオフセットと
 *   スポーク穴径は 0.1 刻みなので、出ないと入力できない
 *
 * inputMode はソフトキーボードを決める標準の属性なので、数字パッドは type="number" の
 * ときと変わらず出る。0.1 刻みの欄はむしろ小数点キーが確実に出るようになる。
 * 代わりにブラウザが持っていた矢印キー増減とスピンボタンは失われるので、
 * どちらもこのコンポーネントが持ち直している —— スピンボタンの「押しっぱなしで
 * 連続して進む」ぶんも含めて (useHoldRepeat)。矢印キー側は keydown のオート
 * リピートがそのまま繰り返しになるので、こちらは何も足していない。
 */
export const NumberInput: React.FC<NumberInputProps> = ({
  id,
  label,
  value,
  onChange,
  onBlur,
  step,
  min,
  max,
  error,
  describedBy,
  placeholder,
  className,
}) => {
  const { t } = useTranslation();
  // IME 変換中かどうか。変換の途中経過を濾過で書き換えると変換そのものが壊れる。
  // type="number" の頃は IME がそもそも起動しなかったので要らなかった。
  const isComposing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stepOptions = { step, min, max };

  // 表示中の値の写し。増減の起点に使う (理由は commitStep)。
  // 描画のたびに prop へ揃え直すので、外から値が入れ替わったとき
  // (プリセットの読み込み、共有リンクの復元、手打ち) にも置いていかれない。
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;

    onChange(isComposing.current ? raw : sanitizeNumericText(raw));
  };

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    isComposing.current = false;
    onChange(sanitizeNumericText(event.currentTarget.value));
  };

  const handleBlur = () => {
    onBlur?.();

    const formatted = formatNumericText(value, step);

    if (formatted !== value) {
      onChange(formatted);
    }
  };

  /**
   * 1 段ぶん動かす。動いたら true、端に着いていて動けなければ false。
   *
   * 起点は prop の value ではなく写しの ref。長押しの繰り返しは 50ms ごとに来るので、
   * 親の再描画がそれに間に合わなかった回のぶん、同じ段を二度踏むことになる。
   * 自分で進めた値をそのまま次の起点にすれば、結果が再描画の速さに依らない。
   */
  const commitStep = (direction: 1 | -1): boolean => {
    const current = valueRef.current;
    const next = stepNumericText(current, direction, stepOptions);

    // stepNumericText は min / max でクランプするので、端では起点と同じ文字列が返る。
    // 「動かなかった = そこが端」なので、長押しの繰り返しはこれを合図に止まる
    if (next === current) {
      return false;
    }

    valueRef.current = next;
    onChange(next);

    return true;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }

    // text の既定動作 (キャレットを先頭・末尾へ) を止めて増減に充てる。
    // これが type="number" のときブラウザがやっていたこと。
    event.preventDefault();
    commitStep(event.key === 'ArrowUp' ? 1 : -1);
  };

  // ステッパーへフォーカスを移させない。useHoldRepeat が pointerdown を抑止し、
  // タッチの長押しも含めてフォーカスを保つ。mousedown の抑止も残す。
  // 移させないのは 3 つの理由から:
  //
  // - ステッパーが出ている条件が group-focus-within なので、フォーカスが入力欄から
  //   外れた瞬間にボタンごと消える。押している最中に消えれば click は届かない
  // - 入力欄から外れると blur が走り、桁揃えが増減と同じ操作の中で二重に動く
  // - モバイルでソフトキーボードが閉じる。ステッパーはキーボードを打たずに
  //   値を動かすための部品なので、これでは本末転倒
  const keepFocusInField = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  // ポインタ操作ではフォーカスは入力欄に留まる。支援技術からの click などで
  // ステッパーにフォーカスがあるときも、入力欄へ戻して続けて操作できるようにする。
  const handleStep = (direction: 1 | -1): boolean => {
    const stepped = commitStep(direction);

    inputRef.current?.focus();

    return stepped;
  };

  // 押しっぱなしで連続して進むぶん。1 段目も含めて押し下げ側が持つ
  const holdStepDown = useHoldRepeat(() => handleStep(-1));
  const holdStepUp = useHoldRepeat(() => handleStep(1));

  /**
   * ポインタから起きた click は捨てる。押し下げ (onPointerDown) で既に 1 段
   * 動かしているので、ここでも拾うと 1 タップで 2 段進む。
   *
   * 捨てずに残すのは detail が 0 の click。UI Events の detail はクリック回数なので、
   * 実際の押し下げから起きた click は必ず 1 以上になる。0 で来るのは支援技術や
   * キーボードが合成したもの (element.click() 相当) で、対応する pointerdown を持たない。
   * ステッパーは tabIndex={-1} で Tab の順路には無いが、VoiceOver / TalkBack の
   * スワイプ移動では届く —— この道を塞ぐと、そこからは増減できなくなる。
   */
  const handleVirtualClick = (direction: 1 | -1) => (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) {
      return;
    }

    handleStep(direction);
  };

  return (
    <div className="group/field relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        // step で振り分けないこと。7 欄すべてが小数を受ける (CalculatorPage の
        // decimalPattern はどの欄でも小数を通す) ので、1 刻みの欄でも小数点キーが要る
        // —— フランジ距離や PCD は 22.6 のような値を普通に取る。numeric にすると
        // モバイルでそれらの欄に小数を打てなくなる。step は増減の刻み幅でしかない。
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        value={value}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : describedBy}
        className={getNumberInputClassName(error !== undefined, className)}
        placeholder={placeholder}
      />
      {/*
        入力欄に重ねる。inset-y-0 + items-center で欄の高さに関係なく中央へ寄る。
        欄の枠の内側に収まるよう右端は 1 (4px) 空ける。

        出るのはフォーカス中だけ。触っていない欄は現状と 1px も変わらない。

        隠すのに hidden ではなく invisible + opacity-0 を使う。display を切り替えると
        支援技術からも消えたり現れたりするうえ、フェードも掛けられない。visibility:
        hidden なら支援技術からは外れつつ、箱の寸法は保たれたままになる。

        group は必ず名前付き (group/field) にすること。素の group-focus-within: が
        生む選択子は `.group:focus-within &` で、祖先のどの group にも一致する。
        入力欄の並び全体を包む div も group を持っている (CalculatorPage) ため、
        名前を付けないとどれか 1 欄に触れただけで 7 欄ぶんのステッパーが一斉に出る。

        ステッパーを押している間これが false に転じないことが要る (転じるとボタンが
        消えて click が届かない)。フォーカスは入力欄から動かないので focus-within は
        押している間ずっと true —— useHoldRepeat と keepFocusInField がこれを担う。
      */}
      <div
        className={
          'absolute inset-y-0 right-1 flex items-center invisible opacity-0 transition-opacity ' +
          'group-focus-within/field:visible group-focus-within/field:opacity-100'
        }
      >
        <button
          type="button"
          // Tab の停止を増やさない。数値欄は 7 つあるので、両脇を足すと 14 個増える。
          // キーボードでの増減は入力欄の矢印キーが持っており、tabIndex={-1} でも
          // VoiceOver / TalkBack のスワイプ移動では届くので支援技術からは失われない。
          tabIndex={-1}
          disabled={!canStepNumericText(value, -1, stepOptions)}
          aria-label={t('input.stepDown', { label })}
          onMouseDown={keepFocusInField}
          onPointerDown={holdStepDown}
          onClick={handleVirtualClick(-1)}
          className={stepperGhost}
        >
          <Minus aria-hidden="true" className={btnIcon} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={!canStepNumericText(value, 1, stepOptions)}
          aria-label={t('input.stepUp', { label })}
          onMouseDown={keepFocusInField}
          onPointerDown={holdStepUp}
          onClick={handleVirtualClick(1)}
          className={stepperGhost}
        >
          <Plus aria-hidden="true" className={btnIcon} />
        </button>
      </div>
    </div>
  );
};
