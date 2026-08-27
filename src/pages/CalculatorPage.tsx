import React, { useState, useEffect, useId, useMemo, useRef } from 'react';
import { Circle, Copy, Download, TriangleAlert, Waypoints } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../hooks/useToast';
import { useDockMorph } from '../hooks/useDockMorph';
import { ActionBar } from '../components/ActionBar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HelpButton } from '../components/HelpButton';
import { HelpModal, type HelpTopic } from '../components/HelpModal';
import { InitialDataAlert } from '../components/InitialDataAlert';
import { Modal } from '../components/Modal';
import { SaveDialog } from '../components/SaveDialog';
import { MtbHubIcon } from '../components/icons/MtbHubIcon';
import CompareWheels, { type WheelOption } from '../components/CompareWheels';
import { NumberInput } from '../components/NumberInput';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import { PresetSelect, type PresetSelectGroup } from '../components/PresetSelect';
import { btnIcon, btnSecondaryIcon, sectionHeadingIcon } from '../styles';
import { assessRimOffset, getEffectiveFlangeDistances, type RimOffsetAssessment } from '../rimOffset';
import {
  HUB_FIELDS,
  RIM_FIELDS,
  buildPartPresets,
  matchPreset,
  type MatchablePreset,
  type PartPresetOption,
} from '../partPresets';
import { buildShareUrl, hasShareFragment, parseShareFragment } from '../shareLink';

// Dynamic import of preset data
// `*` は `/` をまたがないので、この glob は下の hubs/ rims/ を拾わない。
const presetModules = import.meta.glob('../presets/*.json', { eager: true });
const hubPresetModules = import.meta.glob('../presets/hubs/*.json', { eager: true });
const rimPresetModules = import.meta.glob('../presets/rims/*.json', { eager: true });

// Type definitions
// interface ではなく type エイリアス。interface には暗黙のインデックスシグネチャが
// 付かないので Record<string, string> を要求する matchPreset に渡せない。
type Inputs = {
  erd: string;
  rimOffset: string;
  pitchCircleLeft: string;
  pitchCircleRight: string;
  flangeDistanceLeft: string;
  flangeDistanceRight: string;
  spokeHoleDiameter: string;
  numberOfSpokes: string;
  crossingsLeft: string;
  crossingsRight: string;
};

interface Results {
  left: number;
  right: number;
}

interface SavedCalculation {
  id: number;
  name: string;
  inputs: Inputs;
  results: Results;
  timestamp: string;
}

interface PresetData {
  inputs: Inputs;
  results: Results;
  timestamp: string;
  metadata: {
    calculator: string;
    version: string;
  };
  displayName?: string;
  category?: string;
  description?: string;
}

interface PresetOption {
  id: string;
  name: string;
  data: PresetData;
}

type InitialDataLoadStatus = 'ok' | 'warning' | 'error';

interface PresetLoadResult {
  options: PresetOption[];
  errors: string[];
}

interface SavedCalculationsLoadResult {
  calculations: SavedCalculation[];
  status: InitialDataLoadStatus;
  details: string[];
}

type InputField = keyof Inputs;
type NumericInputField = Exclude<InputField, 'numberOfSpokes' | 'crossingsLeft' | 'crossingsRight'>;
type FieldErrors = Partial<Record<InputField, string>>;
type TouchedFields = Partial<Record<InputField, boolean>>;

interface ParsedInputs {
  erd: number;
  rimOffset: number;
  pitchCircleLeft: number;
  pitchCircleRight: number;
  flangeDistanceLeft: number;
  flangeDistanceRight: number;
  spokeHoleDiameter: number;
  numberOfSpokes: number;
  crossingsLeft: number;
  crossingsRight: number;
}

interface CalculationState {
  fieldErrors: FieldErrors;
  results: Results | null;
}

const inputFields = [
  'erd',
  'rimOffset',
  'pitchCircleLeft',
  'pitchCircleRight',
  'flangeDistanceLeft',
  'flangeDistanceRight',
  'spokeHoleDiameter',
  'numberOfSpokes',
  'crossingsLeft',
  'crossingsRight',
] as const satisfies readonly InputField[];

// 部品プリセットの担当欄。partPresets.ts 側は Inputs 型を知らない (Vite 非依存に
// 保って node --test から読めるようにしてある) ので、ここで InputField[] として
// 受け直す。フィールド名のタイポはこの代入でコンパイルエラーになる。
const hubPresetFields: readonly InputField[] = HUB_FIELDS;
const rimPresetFields: readonly InputField[] = RIM_FIELDS;
const HUB_POSITIONS = ['front', 'rear'] as const;

// Tailwind の `sm:` 直下を指す。v4 のブレークポイントは rem (--breakpoint-sm: 40rem)
// なので px で書くとルートフォントサイズを変えたときに CSS と JS がずれる —
// CSS はコンパイルレイアウトなのに JS は長い翻訳文字列を選ぶ、という食い違いになる。
const COMPACT_VIEWPORT_QUERY = '(max-width: 39.9375rem)';

const getIsCompactViewport = () =>
  typeof window !== 'undefined' && window.matchMedia(COMPACT_VIEWPORT_QUERY).matches;

const numericFieldRules: Record<NumericInputField, { min: number; max: number; rangeError: string }> = {
  erd: { min: 1, max: 1000, rangeError: 'validation.rangeErd' },
  rimOffset: { min: 0, max: 100, rangeError: 'validation.rangeRimOffset' },
  pitchCircleLeft: { min: 1, max: 100, rangeError: 'validation.rangeStandard' },
  pitchCircleRight: { min: 1, max: 100, rangeError: 'validation.rangeStandard' },
  flangeDistanceLeft: { min: 1, max: 100, rangeError: 'validation.rangeStandard' },
  flangeDistanceRight: { min: 1, max: 100, rangeError: 'validation.rangeStandard' },
  spokeHoleDiameter: { min: 1, max: 3, rangeError: 'validation.rangeSpokeHole' },
};

const decimalPattern = /^(?:\d+|\d+\.\d*|\.\d+)$/;
const spokeCountOptions = ['24', '28', '32', '36'];
const crossingOptions = ['0', '1', '2', '3', '4'];

const createTouchedFields = (value: boolean): TouchedFields => (
  inputFields.reduce<TouchedFields>((acc, field) => {
    acc[field] = value;
    return acc;
  }, {})
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const normalizeInputValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

const normalizeInputs = (value: unknown): Inputs | null => {
  if (!isRecord(value)) {
    return null;
  }

  const normalized: Partial<Inputs> = {};

  for (const field of inputFields) {
    const normalizedValue = field === 'rimOffset' && value[field] === undefined
      ? '0'
      : normalizeInputValue(value[field]);

    if (normalizedValue === null) {
      return null;
    }

    normalized[field] = normalizedValue;
  }

  return normalized as Inputs;
};

const normalizeResults = (value: unknown): Results | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { left, right } = value;

  if (typeof left !== 'number' || typeof right !== 'number') {
    return null;
  }

  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }

  return { left, right };
};

const parseNumericField = (field: NumericInputField, rawValue: string): { value: number | null; error?: string } => {
  const trimmedValue = rawValue.trim();
  const rule = numericFieldRules[field];

  if (trimmedValue === '') {
    return { value: null, error: 'validation.required' };
  }

  if (!decimalPattern.test(trimmedValue)) {
    return { value: null, error: 'validation.invalidNumber' };
  }

  const value = Number(trimmedValue);

  if (!Number.isFinite(value)) {
    return { value: null, error: 'validation.invalidNumber' };
  }

  if (value < rule.min || value > rule.max) {
    return { value: null, error: rule.rangeError };
  }

  return { value };
};

const parseSelectField = (
  rawValue: string,
  options: readonly string[],
  invalidError: string,
): { value: number | null; error?: string } => {
  const trimmedValue = rawValue.trim();

  if (trimmedValue === '') {
    return { value: null, error: 'validation.selectRequired' };
  }

  if (!options.includes(trimmedValue)) {
    return { value: null, error: invalidError };
  }

  const value = Number(trimmedValue);

  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    return { value: null, error: invalidError };
  }

  return { value };
};

const validateInputs = (inputs: Inputs): { parsed: ParsedInputs | null; fieldErrors: FieldErrors } => {
  const fieldErrors: FieldErrors = {};
  const parsed: Partial<ParsedInputs> = {};

  for (const field of Object.keys(numericFieldRules) as NumericInputField[]) {
    const result = parseNumericField(field, inputs[field]);

    if (result.error !== undefined || result.value === null) {
      fieldErrors[field] = result.error || 'validation.invalidNumber';
      continue;
    }

    parsed[field] = result.value;
  }

  const spokeCount = parseSelectField(inputs.numberOfSpokes, spokeCountOptions, 'validation.selectSpokeCount');
  if (spokeCount.error !== undefined || spokeCount.value === null) {
    fieldErrors.numberOfSpokes = spokeCount.error || 'validation.selectSpokeCount';
  } else {
    parsed.numberOfSpokes = spokeCount.value;
  }

  const crossingsLeft = parseSelectField(inputs.crossingsLeft, crossingOptions, 'validation.selectCrossings');
  if (crossingsLeft.error !== undefined || crossingsLeft.value === null) {
    fieldErrors.crossingsLeft = crossingsLeft.error || 'validation.selectCrossings';
  } else {
    parsed.crossingsLeft = crossingsLeft.value;
  }

  const crossingsRight = parseSelectField(inputs.crossingsRight, crossingOptions, 'validation.selectCrossings');
  if (crossingsRight.error !== undefined || crossingsRight.value === null) {
    fieldErrors.crossingsRight = crossingsRight.error || 'validation.selectCrossings';
  } else {
    parsed.crossingsRight = crossingsRight.value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { parsed: null, fieldErrors };
  }

  const completeParsed = parsed as ParsedInputs;

  if (completeParsed.numberOfSpokes <= 0 || completeParsed.numberOfSpokes % 2 !== 0) {
    return {
      parsed: null,
      fieldErrors: {
        numberOfSpokes: 'validation.selectSpokeCount',
      },
    };
  }

  const effectiveFlangeDistances = getEffectiveFlangeDistances(completeParsed);

  if (effectiveFlangeDistances.left <= 0 || effectiveFlangeDistances.right <= 0) {
    return {
      parsed: null,
      fieldErrors: {
        rimOffset: 'validation.rimOffsetTooLarge',
      },
    };
  }

  return { parsed: completeParsed, fieldErrors };
};

const getRimOffsetAssessment = (inputs: Inputs): RimOffsetAssessment => {
  const rimOffset = parseNumericField('rimOffset', inputs.rimOffset);
  const flangeDistanceLeft = parseNumericField('flangeDistanceLeft', inputs.flangeDistanceLeft);
  const flangeDistanceRight = parseNumericField('flangeDistanceRight', inputs.flangeDistanceRight);

  if (
    rimOffset.value === null
    || rimOffset.error !== undefined
    || flangeDistanceLeft.value === null
    || flangeDistanceLeft.error !== undefined
    || flangeDistanceRight.value === null
    || flangeDistanceRight.error !== undefined
  ) {
    return { kind: 'none' };
  }

  return assessRimOffset({
    rimOffset: rimOffset.value,
    flangeDistanceLeft: flangeDistanceLeft.value,
    flangeDistanceRight: flangeDistanceRight.value,
  });
};

const calculateSpokeResults = (inputs: ParsedInputs): Results | null => {
  const spokesPerSide = inputs.numberOfSpokes / 2;
  const effectiveFlangeDistances = getEffectiveFlangeDistances(inputs);

  if (!Number.isFinite(spokesPerSide) || spokesPerSide <= 0) {
    return null;
  }

  const calculateLength = (pitchCircle: number, flangeDistance: number, crossings: number): number | null => {
    const flangeRadius = pitchCircle / 2;
    const rimRadius = inputs.erd / 2;
    const theta = (2 * Math.PI * crossings) / spokesPerSide;

    if (!Number.isFinite(theta)) {
      return null;
    }

    const projectedLengthSquared = (
      flangeRadius * flangeRadius
      + rimRadius * rimRadius
      - 2 * flangeRadius * rimRadius * Math.cos(theta)
    );

    if (!Number.isFinite(projectedLengthSquared) || projectedLengthSquared < -1e-9) {
      return null;
    }

    const projectedLength = Math.sqrt(Math.max(0, projectedLengthSquared));
    const length = Math.sqrt(projectedLength * projectedLength + flangeDistance * flangeDistance)
      - inputs.spokeHoleDiameter / 2;
    const roundedLength = Math.floor(length * 10) / 10;

    if (!Number.isFinite(roundedLength) || roundedLength <= 0) {
      return null;
    }

    return roundedLength;
  };

  const left = calculateLength(inputs.pitchCircleLeft, effectiveFlangeDistances.left, inputs.crossingsLeft);
  const right = calculateLength(inputs.pitchCircleRight, effectiveFlangeDistances.right, inputs.crossingsRight);

  if (left === null || right === null) {
    return null;
  }

  return { left, right };
};

const getCalculationState = (inputs: Inputs): CalculationState => {
  const validation = validateInputs(inputs);

  if (validation.parsed === null) {
    return {
      fieldErrors: validation.fieldErrors,
      results: null,
    };
  }

  const results = calculateSpokeResults(validation.parsed);

  if (results === null) {
    return {
      fieldErrors: {
        erd: 'validation.calculationUnavailable',
      },
      results: null,
    };
  }

  return {
    fieldErrors: {},
    results,
  };
};

const normalizeSavedCalculation = (value: unknown): SavedCalculation | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { id, name, inputs, timestamp } = value;
  const normalizedInputs = normalizeInputs(inputs);

  if (
    typeof id !== 'number'
    || !Number.isFinite(id)
    || typeof name !== 'string'
    || typeof timestamp !== 'string'
    || normalizedInputs === null
  ) {
    return null;
  }

  const calculation = getCalculationState(normalizedInputs);

  if (calculation.results === null) {
    return null;
  }

  return {
    id,
    name,
    inputs: normalizedInputs,
    results: calculation.results,
    timestamp,
  };
};

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

const loadPresetOptions = (): PresetLoadResult => {
  const options: PresetOption[] = [];
  const errors: string[] = [];

  for (const [path, module] of Object.entries(presetModules)) {
    try {
      const data = module as PresetData;
      const normalizedInputs = normalizeInputs(data.inputs);
      const normalizedResults = normalizeResults(data.results);

      if (normalizedInputs === null || normalizedResults === null) {
        errors.push(`Invalid preset format in ${path}: missing or invalid required fields`);
        continue;
      }

      const presetCalculation = getCalculationState(normalizedInputs);

      if (presetCalculation.results === null) {
        errors.push(`Invalid preset format in ${path}: preset inputs cannot be calculated`);
        continue;
      }

      const fileName = path.split('/').pop()?.replace('.json', '') || '';
      const displayName = data.displayName || fileName
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());

      options.push({
        id: fileName,
        name: displayName,
        data: {
          ...data,
          inputs: normalizedInputs,
          results: presetCalculation.results,
        },
      });
    } catch (error) {
      errors.push(`Failed to load preset from ${path}: ${getErrorMessage(error)}`);
    }
  }

  return { options, errors };
};

const loadSavedCalculations = (): SavedCalculationsLoadResult => {
  try {
    const saved = localStorage.getItem('spokeCalculations');

    if (saved === null) {
      return { calculations: [], status: 'ok', details: [] };
    }

    const parsed: unknown = JSON.parse(saved);

    if (!Array.isArray(parsed)) {
      throw new Error('Saved calculations must be an array');
    }

    const calculations = parsed
      .map(normalizeSavedCalculation)
      .filter((calculation): calculation is SavedCalculation => calculation !== null);
    const invalidCount = parsed.length - calculations.length;

    if (invalidCount > 0) {
      return {
        calculations,
        status: 'warning',
        details: [`Discarded ${invalidCount} invalid saved calculation(s)`],
      };
    }

    return { calculations, status: 'ok', details: [] };
  } catch (error) {
    return {
      calculations: [],
      status: 'error',
      details: [getErrorMessage(error)],
    };
  }
};

// 何も共有されていないときの入力値。共有 URL の復元に失敗したときの着地点でもある。
const DEFAULT_INPUTS: Inputs = {
  erd: '',
  rimOffset: '0',
  pitchCircleLeft: '',
  pitchCircleRight: '',
  flangeDistanceLeft: '',
  flangeDistanceRight: '',
  spokeHoleDiameter: '2.6', // Hope Pro 5 value as default (author's personal preference)
  numberOfSpokes: '32', // Generally 32 spokes is common
  crossingsLeft: '3', // 3-cross is also typical
  crossingsRight: '3', // 3-cross is also typical
};

type SharedInputsLoadResult =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; inputs: Inputs };

// 共有 URL の fragment から入力値を復元する。
//
// 検証は専用のものを書かず、保存データや JSON 読み込みと同じ normalizeInputs →
// getCalculationState を通す。共有 URL は計算結果が出ているときにしか作れないので、
// 計算できない値が入っているなら途中で壊れたということ —— 読める欄だけ拾って
// 「それらしく」起動すると、共有した側とされた側で別の条件を見ることになる。
// だから部分採用はせず、全部捨てて通常の初期状態に落とす。
//
// URL は書き換えない。読み込み時に fragment を消すと再読み込みで共有内容が失われ、
// 逆に入力のたびに書き足すと issue #98 の「通常操作中は URL を更新しない」に反する。
const loadSharedInputs = (): SharedInputsLoadResult => {
  if (typeof window === 'undefined') {
    return { status: 'none' };
  }

  const fragment = window.location.hash;

  // 共有 URL を名乗っていない fragment (ページ内リンクなど) は黙って無視する。
  // 逆に名乗っているものは、読めなければ利用者に伝える必要がある (下の invalid)。
  if (!hasShareFragment(fragment)) {
    return { status: 'none' };
  }

  const values = parseShareFragment(fragment);

  if (values === null) {
    return { status: 'invalid' };
  }

  const normalizedInputs = normalizeInputs(values);

  if (normalizedInputs === null || getCalculationState(normalizedInputs).results === null) {
    return { status: 'invalid' };
  }

  return { status: 'ok', inputs: normalizedInputs };
};

const INITIAL_SHARED_INPUTS = loadSharedInputs();

const PRESET_LOAD_RESULT = loadPresetOptions();
// ハブ / リム単体のプリセット。全体プリセットと違い 10 項目すべては持たないので
// getCalculationState では検証できず、専用のローダーを通す。
const HUB_PRESET_LOAD_RESULT = buildPartPresets(hubPresetModules, HUB_FIELDS, true);
const RIM_PRESET_LOAD_RESULT = buildPartPresets(rimPresetModules, RIM_FIELDS, false);
const INITIAL_SAVED_CALCULATIONS = loadSavedCalculations();

const PRESET_LOAD_ERRORS = [
  ...PRESET_LOAD_RESULT.errors,
  ...HUB_PRESET_LOAD_RESULT.errors,
  ...RIM_PRESET_LOAD_RESULT.errors,
];

for (const error of PRESET_LOAD_ERRORS) {
  console.error(error);
}

if (INITIAL_SAVED_CALCULATIONS.status !== 'ok') {
  console.warn(
    'Failed to load all saved calculations:',
    ...INITIAL_SAVED_CALCULATIONS.details,
  );
}

const FieldError: React.FC<{ id: string; message?: string }> = ({ id, message }) => {
  const hasMessage = message !== undefined;

  return (
    <p
      id={id}
      aria-hidden={!hasMessage}
      aria-live="polite"
      className={[
        'mt-1 h-5 overflow-hidden whitespace-nowrap text-xs leading-5 text-danger-ink sm:text-sm',
        hasMessage ? '' : 'invisible',
      ].join(' ')}
    >
      {message}
    </p>
  );
};

const FieldWarning: React.FC<{ id: string; message: string }> = ({ id, message }) => (
  <p
    id={id}
    aria-live="polite"
    className="flex min-h-5 items-start gap-1.5 mt-1 text-xs leading-5 text-warn-ink sm:text-sm"
  >
    <TriangleAlert aria-hidden="true" className="shrink-0 mt-0.5 h-4 w-4" />
    <span>{message}</span>
  </p>
);

// 結果帯の 2 つの姿。--dock 0 が本来の姿、1 が簡易表示で、間はすべて線形補間。
// 数値は現行の Tailwind クラスの実寸をそのまま rem にしたもの:
//   pad        … p-5 / p-6
//   headingLine… 見出し (text-xl) の行高
//   headingGap … 見出しの mb-4
//   gridMin    … 数値グリッドの min-h-24 / sm:min-h-20
//   label      … text-sm / sm:text-base
//   value      … text-2xl / sm:text-3xl
// クラスではなくインラインの数値で持つのは、中間値がユーティリティの
// スケール上に存在しないため。補間する以上リテラルにするしかない。
//
// 単位が px ではなく rem なのは、帯だけがブラウザの既定フォントサイズ設定に
// 追従しない状態を避けるため (#155)。他の区画は Tailwind のユーティリティ (rem) で
// 書かれているので、px で持つとこのアプリで一番読みたい数字だけが大きくならない。
// 補間は calc() が行うので、ルートフォントサイズを JS で読む必要はない ——
// calc(1.25rem - 0.625rem * var(--dock)) をブラウザがそのまま解決する。
const BAND_FULL_NARROW = { pad: 1.25, headingLine: 1.75, headingGap: 1, gridMin: 6, label: 0.875, value: 1.5 };
const BAND_FULL_WIDE = { pad: 1.5, headingLine: 1.75, headingGap: 1, gridMin: 5, label: 1, value: 1.875 };

// 簡易表示。画面下端に貼り付くので、見出しもラベルも畳んで数値だけを残す。
// 横の余白 (pad) は畳まない —— 数値の x 座標が動くと「同じものが縮んだ」
// ではなく「別のものに入れ替わった」に見えてしまう。
//
// gridMin を 0 ではなく実値で持つのは、これが簡易表示の高さを決めているから。
// 数値だけの行の実寸 (value 1.125rem × leading-tight = 1.40625rem) を上回る値にして、
// 高さが全区間で gridMin 側で決まるようにしてある。こうすると帯の高さが --dock の
// 一次関数になり、DOCK_ABSORB で変形距離を詰めても不変条件を保てる。
// 逆にここが 0 のままだと高さは折れ線になり、着地直前の変化率が跳ね上がる。
// 狭い画面で文字を大きくすると数値が 2 行になり、この関係は崩れる。崩れても
// スペーサーは帯の実高に追従するので文書の高さは動かない (#157) が、
// 一次関数でいられるほうが変形は素直なので、この値は保つ。
//
// 見出しとラベルの畳み方は下の ResultBand / ResultBandValue を参照。
// どちらも「見えている間は切り落とさない」ことを守る。
const BAND_COMPACT = { pad: 0.625, headingLine: 0, headingGap: 0, gridMin: 1.625, label: 0.75, value: 1.125 };

// 見出しの文字サイズ。入力値の見出し (下の text-xl) と同値にする —— 同じ階層の見出しなので
// 揃っていないとおかしい。#43 でここだけ 0.875rem に落ちて以降ずれていた (#116)。
// 行高は headingLine / これ の比で持つので、箱の高さは文字サイズに比例して縮む ——
// 切り落とさずに畳めるのはこの比のおかげ。
const BAND_HEADING_FONT = 1.25;

// ラベルの行高。#59 はここを指定せず preflight の 1.5 を継承していたので、
// 明示しても本来の姿の見た目は変わらない。文字サイズに比例することが要点で、
// 箱が font-size と一緒に縮むので、こちらも切り落とす必要がない。
const LABEL_LINE_RATIO = 1.5;

// ラベルを畳む 2 段階。区間はどちらも --dock の値。
//   FADE     … 完全不透明から透明へ。ここでは箱を触らない (文字は完全サイズのまま)
//   COLLAPSE … 透明になった後で箱を 0 へ。目に見えないので切り落としが問題にならない
// つまり --dock <= LABEL_FADE[0] では常に完全なラベルが出る。
//
// COLLAPSE の終わりが 0.54 なのは幾何の制約。ラベルの箱は gridMin がセル実寸を
// 上回っている間だけ帯の高さに寄与しないが、wide ではセル実寸 (3.84375 - 1.3125d rem) と
// gridMin (5 - 3.375d rem) が d = 0.56 で交差する。その手前で箱を 0 にしておかないと
// 帯の高さが --dock の一次関数でなくなり、下の不変条件の余裕を食う。
const LABEL_FADE = [0.3, 0.45] as const;
const LABEL_COLLAPSE = [0.45, 0.54] as const;

// ラベルの箱の上限として使う値。自然な箱 (1.5 × 1rem = 1.5rem) より大きいので、
// COLLAPSE 区間に入るまで max-height は何も拘束しない
const LABEL_BOX_MAX = 1.875;

// 簡易表示の高さ。border-t の 1px は両方の姿に共通なので変形量には入らない
const BAND_COMPACT_HEIGHT =
  BAND_COMPACT.pad * 2 + BAND_COMPACT.headingLine + BAND_COMPACT.headingGap + BAND_COMPACT.gridMin;

// 帯がスクロールを吸収する割合。1 未満でなければならない ——
// 1 では帯が縮む速さと隙間が広がる速さが釣り合い、変形中ずっと「本来の下端が
// 画面下端にぴったり」の境界に乗る。1 を超えると帯のほうが速く縮み、変形の途中で
// sticky から解放されて画面下端を離れてしまう (簡易表示が本文と一緒に浮き上がる)。
// 小さくすると変形はゆっくりになり、ドック中に入力欄を覆う量が増える。
const DOCK_ABSORB = 0.9;

// --dock を 0..1 の補間係数として使う calc()。スクロール中に動くのは --dock だけなので、
// React はこの文字列を初回に置くだけでよく、再描画は起きない。
//
// フォールバックは 0 = 本来の姿。1 (簡易表示) にしてはならない —— --dock が何かの理由で
// 書かれなかったとき、1 だと帯は見出しもラベルも畳んだ 47px のまま固まり、計算結果が
// 名前のない 2 つの数字になる。実際に #62 でこれが起きた。0 なら最悪でも「ドックしない
// 普通の結果領域」に留まり、内容は失われない。
const DOCK_FALLBACK = 0;

const dockVar = `var(--dock, ${DOCK_FALLBACK})`;

const dockRem = (from: number, to: number): string => {
  const delta = to - from;

  return `calc(${from}rem ${delta < 0 ? '-' : '+'} ${Math.abs(delta)}rem * ${dockVar})`;
};

const dockFadeIn = `calc(1 - ${dockVar})`;

// --dock の [start, end] 区間だけで 0 → 1 に進む係数。区間の外は端点に張り付く。
// 「見えている間は畳まない」を表現するための道具で、フェードと箱の畳みを別の区間に
// 分けるために使う。フックは --dock を書くだけで、区間の切り出しは CSS 側で行う。
const dockRange = ([start, end]: readonly [number, number]): string =>
  `clamp(0, (${dockVar} - ${start}) / ${end - start}, 1)`;

// 上の係数で from → to を補間した rem 値
const dockRemIn = (from: number, to: number, range: readonly [number, number]): string => {
  const delta = to - from;

  return `calc(${from}rem ${delta < 0 ? '-' : '+'} ${Math.abs(delta)}rem * ${dockRange(range)})`;
};

// 上の係数で 1 → 0 に落ちる不透明度
const dockFadeOutIn = (range: readonly [number, number]): string => `calc(1 - ${dockRange(range)})`;

// 折り返す文字の箱の幅。文字サイズと同率で縮めるので、幅と文字サイズの比が --dock に
// よらず一定になり、**どの瞬間も折り返し位置が同じ**になる。
//
// 帯の高さの一次性を守るための道具 (#155)。行数が途中で変わると箱の高さが
// 1 行ぶん跳び、帯は隙間が広がるより速く縮んで sticky から解放される ——
// 実際、rem 化して見出しがブラウザの文字サイズ設定に追従するようにしたところ、
// 既定フォントサイズ 24px の 390px 幅で見出しが 2 行になり、変形の途中で帯が
// 画面下端から 29px 浮き上がった。行数を固定すれば箱は文字サイズに比例したままで、
// 見た目も「同じものが一様に縮む」になる (文字だけ縮んで折り返しが動くと、
// 同じ語が別の行へ飛び移って見える)。
//
// 幅の指定は本来の姿では 100% = 何も拘束しない。縮むのは変形中だけ。
//
// 下限 (`--dock-text-floor`) は useDockMorph が実測して書く。ブラウザの最小フォント
// サイズ設定が効いていると、字面はそれ以上小さくならないのに箱だけが狭まり、
// 折り返しが増えて帯が本来の姿より膨らむ (#157)。使う文字サイズが
// max(下限, 指定サイズ) なら箱も同じ形にすればよい、という対応関係。
// 設定が無ければ下限は 0 に近い値になり、max() は素通しになる。
// 対になる要素には data-dock-text を付けること —— フックはそれを目印に測る。
const dockTextBox = (from: number, to: number): string =>
  `calc(100% * max(var(--dock-text-floor, 0), 1 - ${Number(((from - to) / from).toFixed(6))} * ${dockVar}))`;

// 帯の姿の寸法と、ドック度合いを測るための比。
const bandMetrics = (isCompactViewport: boolean) => {
  const full = isCompactViewport ? BAND_FULL_NARROW : BAND_FULL_WIDE;
  // 本来の姿での高さ
  const fullHeight = full.pad * 2 + full.headingLine + full.headingGap + full.gridMin;
  // 帯が縮むことで吸収する量。スペーサーの高さは実測から書かれるので (#157)、
  // これはフックが動いていないときのフォールバックとしてだけ使う
  const travel = fullHeight - BAND_COMPACT_HEIGHT;

  // 変形が完了するまでのスクロール距離を、本来の高さに対する比で持つ。
  // useDockMorph は本来の高さを DOM から実測するので、フックに渡すのは長さではなく
  // この無次元比になる —— 実測にした理由は useDockMorph のコメントを参照 (#155)。
  // rem 同士の比なのでブラウザの文字サイズ設定によらず一定
  return { full, travel, morphRatio: travel / fullHeight / DOCK_ABSORB };
};

// 計算結果の帯。シート内の 1 区画でありながら、まだそこまでスクロールして
// いない間は画面下端にドックして簡易表示になる。
//
// 重ねた別要素ではなく「帯そのものが変形する」ことが要点。position: sticky で
// 帯自身を画面下端に留め、見出し・ラベル・余白・文字サイズを --dock で線形補間して
// 縮める。だから利用者が見ているものは常に 1 つで、簡易表示と本来の姿の間に
// 乗り換えの瞬間が無い。控えを重ねる実装 (#58 初版) はこれを満たさなかった:
// 別々の 2 つがクロスフェードすると「上に何か出てきた」としか読めない。
// 横の余白と 2 分割グリッドは畳まないので、数値の x 座標は変形中も動かない。
//
// 補間は React ではなく CSS の calc() が行う (#60)。値はシート div の --dock に
// フックが直接書き込むので、この style 文字列はビューポート幅にしか依存せず、
// スクロール中の再描画は 0 回になる。連続値をそのまま使えるので、量子化と
// それを均すための transition が要らない = スクロールに 1:1 で追従する。
//
// useDockMorph をここではなく App で呼ぶのは、シート div の ref を持つのが App だから。
// この帯 (子) の useLayoutEffect の時点では祖先の ref はまだ null で、フックは何もせずに
// 抜け、deps も変わらないので二度と走らない —— #62 の「本来の姿でもラベルが出ない」は
// これが原因だった。観測対象の DOM を所有しているところでフックを呼ぶ。
//
// sticky が効くのはシート div から overflow-hidden を外したため。あれが付いて
// いるとシート自身がスクロールコンテナ扱いになり、中の sticky は「決して
// スクロールしない箱」に対して貼り付こうとして何も起きない。
//
// z-10 —— ドック中は上の入力欄に重なるので、その上に出す。トースト (z-50) や
// モーダル (z-50) より下。
// pointer-events はドック中だけ切る。入力欄の上に浮いている間はタップを
// 塞がないため。本来の位置に着地したら通常どおり選択できる。ドック中かどうかは
// シートの data-docked で伝わる (数値の --dock では pointer-events を表せない)。
//
// transition は色だけに残す。結果が出た瞬間の面の色替えとテーマ切替はここが担うが、
// 寸法に効かせるとスクロールへの追従が遅れる。
//
// aria-hidden は付けない —— 控えを重ねていた頃は二重読み上げを避けるために
// 必要だったが、今は要素が 1 つしかない。見出しは文字サイズ、ラベルは文字サイズと
// 不透明度、そして透明になった後の max-height で畳む。どれも display:none ではないので、
// 簡易表示のときも支援技術からは読める。
//
// 色は accent-soft / sunken ではなく overlay 系トークン。ドック中は本文の上に
// 浮くので、ダークの accent-soft (accent 14%) だと下の入力欄が透けて数値と
// 衝突する (#52)。ライトでは元の値へのエイリアスなので見た目は変わらない。
const ResultBand: React.FC<{
  results: Results | null;
  heading: string;
  placeholder: string;
  leftLabel: string;
  rightLabel: string;
  isCompactViewport: boolean;
  bandRef: React.RefObject<HTMLDivElement | null>;
}> = ({ results, heading, placeholder, leftLabel, rightLabel, isCompactViewport, bandRef }) => {
  const { full, travel } = bandMetrics(isCompactViewport);

  return (
    <>
      <div
        ref={bandRef}
        style={{
          paddingTop: dockRem(full.pad, BAND_COMPACT.pad),
          // 下端にドックしている間はホームインジケータを避ける。畳んだ余白より
          // セーフエリアのほうが大きい端末では、そちらが下限になる
          paddingBottom: `max(${dockRem(full.pad, BAND_COMPACT.pad)}, env(safe-area-inset-bottom, 0px))`,
          paddingLeft: `${full.pad}rem`,
          paddingRight: `${full.pad}rem`,
        }}
        className={[
          'sticky bottom-0 z-10 border-t transition-colors',
          'group-data-[docked]:pointer-events-none',
          results !== null
            ? 'bg-overlay-accent border-overlay-accent-line'
            : 'bg-overlay border-overlay-line',
        ].join(' ')}
      >
        {/* 見出しの段。高さは見出しの箱 (headingLine = 28px) が決める。
            帯は高さがそのまま変形量になる区画なので、ここに行を足してはいけない ——
            足したぶんだけ本来の姿が高くなり、着地までのスクロール距離まで伸びる。
            共有ボタンはこの段に同居していたが、#102 で下のアクションバーへ移した。 */}
        <div
          style={{
            marginBottom: dockRem(full.headingGap, BAND_COMPACT.headingGap),
            opacity: dockFadeIn,
          }}
        >
          {/* 見出しは畳むだけで消さない (max-height ではなく文字サイズを縮めるので
              読み上げ順からも外れない)。
              切り落とし (max-height) ではなく font-size を縮めるのが要点 —— 見出しの箱は
              帯の高さそのものなので全区間に線形で分散させる必要があり、そこで切り落としを
              使うと文字が見えている間ずっと刻まれてしまう (#62)。行高を headingLine /
              BAND_HEADING_FONT の比で持てば、箱は文字サイズに比例して縮むので高さの
              一次性は保たれ、しかもどの瞬間も文字は切れない。
              overflow-hidden は、翻訳が伸びて 2 行になったとき見出しが下の数値に
              被らないようにするため。箱が headingLine の想定を超えても着地位置は
              狂わない —— useDockMorph は本来の下端を DOM から実測している (#155)。 */}
          <h2
            data-dock-text
            style={{
              fontSize: dockRem(BAND_HEADING_FONT, 0),
              lineHeight: full.headingLine / BAND_HEADING_FONT,
              width: dockTextBox(BAND_HEADING_FONT, 0),
            }}
            className="min-w-0 overflow-hidden font-semibold text-fg"
          >
            {heading}
          </h2>
        </div>
        <div
          style={{ minHeight: dockRem(full.gridMin, BAND_COMPACT.gridMin) }}
          className="grid w-full grid-cols-2 items-center gap-3 text-center sm:gap-4"
        >
          {results !== null ? (
            <>
              <ResultBandValue label={leftLabel} value={results.left} full={full} />
              <ResultBandValue label={rightLabel} value={results.right} full={full} />
            </>
          ) : (
            /* 文言は短く保つ。帯の中で唯一「文」が流れるのがここなので、老眼対応で
               ブラウザの文字サイズを上げている利用者では真っ先に折り返す
               (#154 は最小フォントサイズ 16px・390px 幅で 2 行)。現行の文言なら
               320px 幅・最小フォント 20px までは 1 行に収まる。
               縮めて収めるのは老眼対応の逆なので、幅は文言の側で空ける。
               text-balance はそれを超えて折り返したときの保険で、1 行なら何も起きない。
               見出しが直上に「計算結果」と出ているので、ここで繰り返さなくてよい。 */
            <p
              data-dock-text
              style={{
                fontSize: dockRem(full.label, BAND_COMPACT.label),
                width: dockTextBox(full.label, BAND_COMPACT.label),
              }}
              // mx-auto —— 箱が縮んでも中央に置いた文字の x 座標が動かないように
              className="col-span-2 mx-auto text-balance text-fg-subtle"
            >
              {placeholder}
            </p>
          )}
        </div>
      </div>
      {/* 帯が縮んだぶんを埋める。帯 + ここの合計が本来の高さのままなので、変形中も
          シート以下・文書全体・スクロール可能範囲の高さが変わらない。再レイアウトは帯の
          内部に閉じ、保存欄や比較パネルの再配置とスクロール範囲の再計算が消える。
          ドック中は帯の本来の下端が必ず画面下端より下にあるので、ここが見えることはない。
          高さは --dock からの計算ではなく、useDockMorph が実測から書く px 値で受ける
          (本来の高さ - 帯の実高)。rem 定数で持っていた頃は、狭い画面で文字を大きくして
          帯の実際の変形量がモデルからずれると合計が一定でなくなり、ドック中だけ文書が
          数十 px 伸縮していた (#157)。フォールバックの calc() は旧来のモデルそのもので、
          フックが動いていないときだけ効く */}
      <div aria-hidden="true" style={{ height: `var(--band-spacer, ${dockRem(0, travel)})` }} />
    </>
  );
};

// 帯の 1 セル。ラベルと数値の積み方は変えない —— 縦積みと横並びを切り替えると、
// その瞬間だけ別のレイアウトが割り込んで「変形」に見えなくなる。
//
// ラベルは 3 段構えで畳む (#62)。--dock 0.3 までは完全サイズ・完全不透明、そこから
// 0.45 で透明になり、透明になってから 0.54 までに箱を 0 へ畳む。**見えている間は
// 縮小も切り落としも起きない** —— 本来の姿とその近傍で常に完全なラベルが出ることを
// この順序が保証する。ラベルが無くて良いのは簡易表示だけ。
//
// この遅延が幾何的に無料なのは、ラベルの箱が gridMin がセル実寸を上回っている間は
// 帯の高さに寄与しないため。逆に区間の終わりを遅らせすぎると wide で交差してしまう
// (LABEL_COLLAPSE のコメント参照)。
const ResultBandValue: React.FC<{
  label: string;
  value: number;
  full: typeof BAND_FULL_NARROW;
}> = ({ label, value, full }) => (
  <div>
    <h3
      style={{
        // 数値と同率で縮める (#59 と同じ補間)。行高は比で持つので箱も一緒に縮み、
        // 切り落としなしで小さくなる
        fontSize: dockRem(full.label, BAND_COMPACT.label),
        lineHeight: LABEL_LINE_RATIO,
        // 箱を畳むのはフェードが終わった後だけ。それまでは LABEL_BOX_MAX が
        // 自然な箱より大きいので何も拘束しない
        maxHeight: dockRemIn(LABEL_BOX_MAX, 0, LABEL_COLLAPSE),
        opacity: dockFadeOutIn(LABEL_FADE),
      }}
      // overflow は切らない。箱が中身より小さくなるのは (a) 不透明度が 0 になった後の
      // max-height 畳み —— 見えないので切る意味がない —— と、(b) ブラウザの最小フォント
      // サイズ設定が字面だけを持ち上げた場合の 2 つだけ。(b) で切ると、文字を大きくして
      // いる利用者にだけラベルが欠けて見える (最小フォント 24px で 6px 欠けていた #157)。
      // 老眼対応の逆になるので、はみ出させて読ませるほうを採る
      className="font-medium text-fg-muted"
    >
      {label}
    </h3>
    <p
      style={{ fontSize: dockRem(full.value, BAND_COMPACT.value) }}
      className="font-semibold leading-tight tabular-nums tracking-tight text-accent-ink"
    >
      {value.toFixed(1)} mm
    </p>
  </div>
);

const spokeCountSegments: SegmentedOption[] = spokeCountOptions.map(value => ({ value, label: value }));

// セグメントには数字だけを描画する。375px では 5 分割で 1 セグメント約 60px しか
// なく、"0 (ラジアル組)" / "0 (Radial Lacing)" は収まらないため。
// 意味は 0 セグメントの aria-label（支援技術向け）と、下の常設キャプション
// （視覚的）の 2 経路で補う。
const useCrossingSegments = (): SegmentedOption[] => {
  const { t } = useTranslation();
  return useMemo(
    () => crossingOptions.map(value => (
      value === '0'
        ? { value, label: value, ariaLabel: t('input.radialLacing') }
        : { value, label: value }
    )),
    [t],
  );
};

// 選択状態に関係なく常に描画する。条件付きにするとレイアウトシフトが起きる
// （FieldError が h-5 を予約しているのと同じ規律）。
const RadialHint: React.FC = () => {
  const { t } = useTranslation();
  return <p className="mt-1 text-xs text-fg-subtle">{t('input.crossingsRadialHint')}</p>;
};

// Groups related input fields under a label, separated by a hairline rule.
// The rule lives on the wrapper rather than on the group itself: a bordered
// fieldset would get a notch cut out of its top border where the legend sits.
//
// fieldset/legend ではなく role="group" + aria-labelledby を使う。見出しの右へ
// プリセットの chip を並べたいのだが、<legend> は fieldset のキャプションとして
// 特別に描かれ、fieldset を grid/flex にしてもアイテムにならないので横に置けない。
// かといって chip を <legend> の中に入れると、グループのアクセシブル名に
// 選択中の部品名まで混ざってしまう。role="group" なら意味を保ったまま
// レイアウトが自由になる (支援技術への伝わり方は fieldset/legend と等価)。
const FieldGroup: React.FC<{
  label: string;
  icon: React.ReactNode;
  /** 見出しの右に置く操作 (プリセットの chip)。 */
  action?: React.ReactNode;
  withRule?: boolean;
  children: React.ReactNode;
}> = ({ label, icon, action, withRule = true, children }) => {
  const labelId = useId();

  return (
    <div className={withRule ? 'border-t border-line pt-6' : undefined}>
      <div role="group" aria-labelledby={labelId}>
        {/* 折り返さない。chip の中身が伸びても行数を変えないため (プリセットを
            選ぶたびに見出しの位置が動くのを防ぐ)。 */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <span id={labelId} className="flex shrink-0 items-center gap-2 text-sm font-semibold text-fg">
            {icon}
            {label}
          </span>
          {action}
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
};

const SpokeLengthCalculator: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const crossingSegments = useCrossingSegments();
  const [isCompactViewport, setIsCompactViewport] = useState(getIsCompactViewport);
  const [inputs, setInputs] = useState<Inputs>(
    INITIAL_SHARED_INPUTS.status === 'ok' ? INITIAL_SHARED_INPUTS.inputs : DEFAULT_INPUTS,
  );

  const presetOptions = PRESET_LOAD_RESULT.options;
  const hubPresetOptions = HUB_PRESET_LOAD_RESULT.options;
  const rimPresetOptions = RIM_PRESET_LOAD_RESULT.options;
  const [savedCalculations, setSavedCalculations] = useState<SavedCalculation[]>(
    INITIAL_SAVED_CALCULATIONS.calculations,
  );
  const [savedDataLoadStatus, setSavedDataLoadStatus] = useState<InitialDataLoadStatus>(
    INITIAL_SAVED_CALCULATIONS.status,
  );
  const [calculationName, setCalculationName] = useState('');
  const [showJsonOutput, setShowJsonOutput] = useState(false);
  const [jsonData, setJsonData] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [calculationToDelete, setCalculationToDelete] = useState<number | null>(null);
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);
  const [touchedFields, setTouchedFields] = useState<TouchedFields>({});
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  // JSON 入力の file input。アクションバーのボタンから click() で開く
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 結果帯の直前の要素。帯は sticky で自分の位置から自分の状態を決められないので、
  // ドック度合いはこの下端 (= 帯の本来の上端) を測って決める
  const inputSectionRef = useRef<HTMLDivElement>(null);
  // 結果帯そのもの。本来の姿の高さと、ドック中に画面下端を覆っている高さを実測する
  const bandRef = useRef<HTMLDivElement>(null);
  // ドック度合い (--dock) の書き込み先。帯だけでなくシート内の兄弟にも継承させたいので、
  // 帯自身ではなくシートに置く
  const sheetRef = useRef<HTMLDivElement>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');

  // 結果帯のドック度合いの計測。ResultBand の中ではなくここで呼ぶ —— 上の ref を
  // 所有しているのが App なので、App の useLayoutEffect が走る時点ですべて attach 済み。
  // 子側で呼ぶと祖先 (シート) の ref がまだ null で、フックが何もせずに抜けてしまう (#62)。
  const bandDock = bandMetrics(isCompactViewport);

  useDockMorph(inputSectionRef, bandRef, sheetRef, bandDock.morphRatio);

  const calculation = useMemo(() => getCalculationState(inputs), [inputs]);
  const currentResults = calculation.results;
  const rimOffsetAssessment = getRimOffsetAssessment(inputs);
  const visibleFieldErrors = useMemo(() => {
    const errors: Partial<Record<InputField, string>> = {};

    for (const field of inputFields) {
      const errorKey = calculation.fieldErrors[field];

      if (errorKey !== undefined && (touchedFields[field] || inputs[field] !== '')) {
        errors[field] = t(errorKey);
      }
    }

    return errors;
  }, [calculation.fieldErrors, inputs, t, touchedFields]);
  const rimOffsetWarning = visibleFieldErrors.rimOffset === undefined
    ? (() => {
      if (rimOffsetAssessment.kind === 'directionIndeterminate') {
        return t('warnings.rimOffsetDirectionIndeterminate');
      }

      if (rimOffsetAssessment.kind === 'worsensAsymmetry') {
        return t('warnings.rimOffsetWorsensAsymmetry', {
          before: rimOffsetAssessment.originalDifference.toFixed(1),
          after: rimOffsetAssessment.effectiveDifference.toFixed(1),
        });
      }

      return undefined;
    })()
    : undefined;
  const hasValidResults = currentResults !== null;

  // 比較の選択肢。プリセットと保存済みに加え、今の入力で計算できているなら
  // それも 1 件として先頭に置く —— 試算のために名前を付けて保存する必要をなくす (#124)。
  // deps に inputs 全体を入れないこと。1 文字打つたびに配列の参照が変わり、
  // memo(CompareWheels) が毎回落ちる。currentResults は useMemo 由来で参照は安定。
  // t は必須 —— 抜くと言語を切り替えてもラベルが旧言語のまま残る (#87)。
  const wheelOptions = useMemo((): WheelOption[] => {
    // 結果が出ている時点で numberOfSpokes は spokeCountOptions のいずれかだと
    // validateInputs が保証しているので、|| 32 のような穴埋めは要らない。
    const currentItems: WheelOption[] = currentResults === null ? [] : [{
      id: 'current',
      label: t('compare.currentInput'),
      group: 'current',
      spec: {
        label: t('compare.currentInput'),
        leftLength: currentResults.left,
        rightLength: currentResults.right,
        spokeCount: Number(inputs.numberOfSpokes),
      },
    }];
    const presetItems: WheelOption[] = presetOptions.map(p => ({
      id: `preset:${p.id}`,
      label: p.name,
      group: 'preset',
      spec: {
        label: p.name,
        leftLength: p.data.results.left,
        rightLength: p.data.results.right,
        spokeCount: parseInt(p.data.inputs.numberOfSpokes, 10) || 32,
      },
    }));
    const savedItems: WheelOption[] = savedCalculations.map(s => ({
      id: `saved:${s.id}`,
      label: s.name,
      group: 'saved',
      spec: {
        label: s.name,
        leftLength: s.results.left,
        rightLength: s.results.right,
        spokeCount: parseInt(s.inputs.numberOfSpokes, 10) || 32,
      },
    }));
    return [...currentItems, ...presetItems, ...savedItems];
  }, [currentResults, inputs.numberOfSpokes, presetOptions, savedCalculations, t]);

  // プリセットの select は選択状態を state で覚えない。今の入力値に一致する定義を
  // 毎回探して value にする —— これだけで「ホイールを選ぶとハブ / リムの欄も点く」
  // 「フランジ距離を手で直すとハブの欄が消える」が同期処理なしに成り立つ。
  const matchableWheelPresets = useMemo(
    (): MatchablePreset[] => presetOptions.map(preset => ({ id: preset.id, fields: preset.data.inputs })),
    [presetOptions],
  );
  const selectedPreset = matchPreset(matchableWheelPresets, inputs, inputFields);
  const selectedHubPreset = matchPreset(hubPresetOptions, inputs, hubPresetFields);
  const selectedRimPreset = matchPreset(rimPresetOptions, inputs, rimPresetFields);

  const wheelPresetGroups = useMemo((): PresetSelectGroup[] => [{
    items: presetOptions.map(preset => ({
      id: preset.id,
      name: preset.name,
      spec: t('input.presetSpec.wheel', {
        erd: preset.data.inputs.erd,
        spokes: preset.data.inputs.numberOfSpokes,
        crossLeft: preset.data.inputs.crossingsLeft,
        crossRight: preset.data.inputs.crossingsRight,
      }),
    })),
  }], [presetOptions, t]);

  // ハブは前後で寸法が違うので optgroup で分ける。フロント組みにリアハブを
  // 選んでしまう事故を、リストの並びの時点で防ぐ。
  const hubPresetGroups = useMemo((): PresetSelectGroup[] => (
    HUB_POSITIONS
      .map(position => ({
        label: t(`input.hubPosition.${position}`),
        items: hubPresetOptions
          .filter(option => option.position === position)
          .map(option => ({
            id: option.id,
            name: option.name,
            spec: t('input.presetSpec.hub', {
              pcdLeft: option.fields.pitchCircleLeft,
              pcdRight: option.fields.pitchCircleRight,
              flangeLeft: option.fields.flangeDistanceLeft,
              flangeRight: option.fields.flangeDistanceRight,
              hole: option.fields.spokeHoleDiameter,
            }),
          })),
      }))
      .filter(group => group.items.length > 0)
  ), [hubPresetOptions, t]);

  const rimPresetGroups = useMemo((): PresetSelectGroup[] => [{
    items: rimPresetOptions.map(option => ({
      id: option.id,
      name: option.name,
      spec: t('input.presetSpec.rim', {
        erd: option.fields.erd,
        offset: option.fields.rimOffset,
      }),
    })),
  }], [rimPresetOptions, t]);

  const resultsLeftText = t(isCompactViewport ? 'results.leftShort' : 'results.left');
  const resultsRightText = t(isCompactViewport ? 'results.rightShort' : 'results.right');

  const markFieldTouched = (field: InputField) => {
    setTouchedFields(prev => ({ ...prev, [field]: true }));
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia(COMPACT_VIEWPORT_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsCompactViewport(event.matches);
    };

    setIsCompactViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  // 共有 URL を名乗る fragment を読めなかったことを伝える。画面は通常の初期状態
  // そのもので、見ただけでは何も起きていないように見える —— 黙っていると
  // 「相手が送った条件を見ている」と思い込んだまま作業してしまう。
  //
  // 起動時の一度きり。StrictMode の二重実行でトーストが 2 枚出ないよう ref で止める。
  const sharedInputsAlertShownRef = useRef(false);

  useEffect(() => {
    if (INITIAL_SHARED_INPUTS.status !== 'invalid' || sharedInputsAlertShownRef.current) {
      return;
    }

    sharedInputsAlertShownRef.current = true;
    showToast(t('alerts.shareLinkInvalid'), 'warning');
  }, [showToast, t]);

  // Update input values
  const handleInputChange = (field: keyof Inputs, value: string) => {
    setInputs(prev => ({ ...prev, [field]: value }));
    setTouchedFields(prev => ({ ...prev, [field]: true }));
  };

  // Save calculation results.
  // 保存できたかどうかを返す —— 呼び出し側 (保存ダイアログ) はこれを見て閉じる。
  // 名前が空のときのように保存しなかった経路で閉じてしまうと、警告のトーストだけが
  // 出てダイアログは消え、「保存された」と誤解させる
  const saveCalculation = (): boolean => {
    if (!calculationName.trim()) {
      showToast(t('alerts.enterCalculationName'), 'warning');
      return false;
    }

    if (currentResults === null) {
      showToast(t('alerts.performCalculationFirst'), 'warning');
      return false;
    }

    const newCalculation: SavedCalculation = {
      id: Date.now(),
      name: calculationName,
      inputs: { ...inputs },
      results: { ...currentResults },
      timestamp: new Date().toLocaleString('ja-JP')
    };

    const updated = [...savedCalculations, newCalculation];
    try {
      localStorage.setItem('spokeCalculations', JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save calculation:', error);
      showToast(t('alerts.saveFailed'), 'error');
      return false;
    }

    setSavedCalculations(updated);
    setSavedDataLoadStatus('ok');
    setCalculationName('');
    showToast(t('alerts.saved'), 'success');

    return true;
  };

  // Load saved calculation
  const loadCalculation = (calculation: SavedCalculation) => {
    setInputs(calculation.inputs);
    setTouchedFields(createTouchedFields(true));
  };

  // 保存ダイアログからの保存・読込。どちらも済んだらダイアログを閉じる ——
  // 結果が反映されるのは背後の入力欄なので、開いたままでは何が起きたか見えない
  const handleSaveRequest = () => {
    if (saveCalculation()) {
      setShowSaveDialog(false);
    }
  };

  const handleLoadRequest = (id: number) => {
    const calculation = savedCalculations.find(calc => calc.id === id);

    if (calculation === undefined) {
      return;
    }

    loadCalculation(calculation);
    setShowSaveDialog(false);
  };

  // Load preset
  const loadPreset = (presetId: string) => {
    const preset = presetOptions.find(p => p.id === presetId);
    if (preset) {
      setInputs(preset.data.inputs);
      setTouchedFields({});
    }
  };

  // Load a hub / rim part preset.
  // 部品は自分の担当欄だけを塗る。全体プリセットのように inputs を丸ごと差し替えると、
  // 組み方の設定やもう一方の部品の値まで巻き添えで消えてしまう。
  //
  // touchedFields には触れない —— 塗った欄は必ず非空になり、visibleFieldErrors は
  // 「touched または非空」で出すので、値がおかしければそのままエラーが見える。
  const loadPartPreset = (options: PartPresetOption[], partId: string) => {
    const part = options.find(option => option.id === partId);

    if (part === undefined) {
      return;
    }

    setInputs(prev => ({ ...prev, ...part.fields }));
  };

  // Delete saved calculation
  const deleteCalculation = (id: number) => {
    setCalculationToDelete(id);
    setShowDeleteConfirm(true);
  };

  // Confirm deletion
  const confirmDelete = () => {
    if (calculationToDelete !== null) {
      const updated = savedCalculations.filter(calc => calc.id !== calculationToDelete);
      try {
        localStorage.setItem('spokeCalculations', JSON.stringify(updated));
      } catch (error) {
        console.error('Failed to delete calculation:', error);
        showToast(t('alerts.deleteFailed'), 'error');
        return;
      }

      setSavedCalculations(updated);
      setSavedDataLoadStatus('ok');
      showToast(t('alerts.deleted'), 'success');
    }
    setShowDeleteConfirm(false);
    setCalculationToDelete(null);
  };

  // Cancel deletion
  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setCalculationToDelete(null);
  };

  // 今の入力条件を共有する。
  //
  // 生成するのはこの操作のときだけで、入力のたびに URL を書き換えることはしない ——
  // 履歴が入力の打鍵で埋まるし、戻るボタンの意味も壊れる。
  //
  // navigator.share() が使える環境では OS の共有シートに任せる。使えない、または
  // シートが開けなかったときだけクリップボードへ落とす。利用者が共有シートを
  // 閉じたとき (AbortError) は失敗ではないので、黙って何もしない ——
  // ここでクリップボードに落とすと、やめたはずの操作が済んだことになってしまう。
  const shareCalculation = async () => {
    if (currentResults === null) {
      showToast(t('alerts.performCalculationFirst'), 'warning');
      return;
    }

    const shareUrl = buildShareUrl(window.location.href, inputs);

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t('title'), url: shareUrl });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        console.error('Failed to open the share sheet:', error);
      }
    }

    if (!navigator.clipboard) {
      showToast(t('alerts.shareLinkCopyFailed'), 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(t('alerts.shareLinkCopied'), 'success');
    } catch (error) {
      console.error('Failed to copy the share link:', error);
      showToast(t('alerts.shareLinkCopyFailed'), 'error');
    }
  };

  // JSON export
  const exportToJSON = () => {
    if (currentResults === null) {
      showToast(t('alerts.performCalculationFirst'), 'warning');
      return;
    }

    const exportData = {
      inputs,
      results: currentResults,
      timestamp: new Date().toISOString(),
      metadata: {
        calculator: 'The Spoke Calculator',
        version: '1.0'
      }
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    setJsonData(jsonString);
    setShowJsonOutput(true);
  };

  // Copy JSON data to clipboard
  const copyToClipboard = () => {
    if (!navigator.clipboard) {
      showToast(t('alerts.copyFailed'), 'error');
      return;
    }

    navigator.clipboard.writeText(jsonData).then(() => {
      showToast(t('alerts.copiedToClipboard'), 'success');
    }).catch(() => {
      showToast(t('alerts.copyFailed'), 'error');
    });
  };

  // Download JSON data as file
  const downloadJSON = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `spoke-calculation-${timestamp}.json`;

    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(t('alerts.jsonDownloaded'), 'success');
  };

  // Load from JSON file
  const loadFromJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        if (e.target && typeof e.target.result === 'string') {
          const parsed: unknown = JSON.parse(e.target.result);

          if (!isRecord(parsed)) {
            showToast(t('alerts.invalidJsonFormat'), 'error');
            return;
          }

          const normalizedInputs = normalizeInputs(parsed.inputs);

          if (normalizedInputs !== null) {
            setInputs(normalizedInputs);
            setTouchedFields(createTouchedFields(true));

            const importedCalculation = getCalculationState(normalizedInputs);
            showToast(
              importedCalculation.results === null
                ? t('alerts.jsonLoadedWithValidationErrors')
                : t('alerts.jsonLoaded'),
              importedCalculation.results === null ? 'warning' : 'success',
            );
          } else {
            showToast(t('alerts.invalidJsonFormat'), 'error');
          }
        }
      } catch {
        showToast(t('alerts.jsonLoadFailed'), 'error');
      }
    };
    reader.onerror = () => {
      showToast(t('alerts.jsonLoadFailed'), 'error');
    };
    reader.readAsText(file);

    // Reset file selection
    event.target.value = '';
  };

  return (
    <>
      {/* 入力と結果を 1 枚のシートに収め、ハイラインで区切る。
          overflow-hidden は付けない —— 付けるとこの div がスクロールコンテナに
          なり、中の結果帯の position: sticky が効かなくなる。子は入力欄・
          結果帯・保存欄の 3 つで、背景を持つのは中央の結果帯だけなので、
          角丸のクリップは元々不要。
          group と ref はドック度合いのため —— --dock と data-docked をここに書き、
          結果帯は group-data-[docked]: で受ける */}
      <div ref={sheetRef} className="group rounded-xl border border-line bg-surface">
        {/* Input section */}
        <div ref={inputSectionRef} className="space-y-6 p-5 sm:p-6">
          {/* プリセットは入力欄ではなく「ここを埋める材料の指定」なので、
              フルワイドのフィールドを積まずに見出し行へ chip として添える。
              折り返しは禁止 —— 選んだプリセット名の長短で行数が変わると、
              選択のたびに見出しごと位置が跳ねる。 */}
          <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
            <h2 className="shrink-0 text-xl font-semibold text-fg">{t('input.heading')}</h2>
            {presetOptions.length > 0 && (
              <PresetSelect
                id="preset"
                label={t('input.preset')}
                placeholder={t('input.presetPlaceholder')}
                value={selectedPreset}
                groups={wheelPresetGroups}
                onSelect={loadPreset}
              />
            )}
          </div>

        <div className="space-y-6">
          {PRESET_LOAD_ERRORS.length > 0 && (
            <InitialDataAlert
              message={t('alerts.presetLoadError')}
              severity="error"
            />
          )}

          <FieldGroup
            label={t('input.group.rim')}
            icon={<Circle aria-hidden="true" className={sectionHeadingIcon} />}
            withRule={false}
            action={rimPresetOptions.length > 0 && (
              <PresetSelect
                id="rimPreset"
                label={t('input.rimPreset')}
                placeholder={t('input.rimPresetPlaceholder')}
                value={selectedRimPreset}
                groups={rimPresetGroups}
                onSelect={partId => loadPartPreset(rimPresetOptions, partId)}
              />
            )}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="block text-sm font-medium text-fg-muted">{t('input.erd')}</label>
                  <HelpButton topic="erd" onOpen={setHelpTopic} />
                </div>
                <NumberInput
                  id="erd"
                  label={t('input.erd')}
                  value={inputs.erd}
                  onChange={(value) => handleInputChange('erd', value)}
                  onBlur={() => markFieldTouched('erd')}
                  step={1}
                  min={1}
                  max={1000}
                  error={visibleFieldErrors.erd}
                  placeholder={t('input.erdPlaceholder')}
                />
                <FieldError id="erd-error" message={visibleFieldErrors.erd} />
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="block text-sm font-medium text-fg-muted">{t('input.rimOffset')}</label>
                  <HelpButton topic="rimOffset" onOpen={setHelpTopic} />
                </div>
                <NumberInput
                  id="rimOffset"
                  label={t('input.rimOffset')}
                  value={inputs.rimOffset}
                  onChange={(value) => handleInputChange('rimOffset', value)}
                  onBlur={() => markFieldTouched('rimOffset')}
                  step={0.1}
                  min={0}
                  max={100}
                  error={visibleFieldErrors.rimOffset}
                  describedBy={rimOffsetWarning !== undefined ? 'rimOffset-warning' : undefined}
                  placeholder={t('input.rimOffsetPlaceholder')}
                />
                {rimOffsetWarning !== undefined ? (
                  <FieldWarning id="rimOffset-warning" message={rimOffsetWarning} />
                ) : (
                  <FieldError id="rimOffset-error" message={visibleFieldErrors.rimOffset} />
                )}
              </div>
            </div>
          </FieldGroup>

          <FieldGroup
            label={t('input.group.hub')}
            icon={<MtbHubIcon aria-hidden="true" className={sectionHeadingIcon} />}
            action={hubPresetOptions.length > 0 && (
              <PresetSelect
                id="hubPreset"
                label={t('input.hubPreset')}
                placeholder={t('input.hubPresetPlaceholder')}
                value={selectedHubPreset}
                groups={hubPresetGroups}
                onSelect={partId => loadPartPreset(hubPresetOptions, partId)}
              />
            )}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="block text-sm font-medium text-fg-muted">{t('input.pcdLeft')}</label>
                  <HelpButton topic="pcd" onOpen={setHelpTopic} />
                </div>
                <NumberInput
                  id="pitchCircleLeft"
                  label={t('input.pcdLeft')}
                  value={inputs.pitchCircleLeft}
                  onChange={(value) => handleInputChange('pitchCircleLeft', value)}
                  onBlur={() => markFieldTouched('pitchCircleLeft')}
                  step={1}
                  min={1}
                  max={100}
                  error={visibleFieldErrors.pitchCircleLeft}
                  placeholder={t('input.pcdLeftPlaceholder')}
                />
                <FieldError id="pitchCircleLeft-error" message={visibleFieldErrors.pitchCircleLeft} />
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="block text-sm font-medium text-fg-muted">{t('input.pcdRight')}</label>
                  <HelpButton topic="pcd" onOpen={setHelpTopic} />
                </div>
                <NumberInput
                  id="pitchCircleRight"
                  label={t('input.pcdRight')}
                  value={inputs.pitchCircleRight}
                  onChange={(value) => handleInputChange('pitchCircleRight', value)}
                  onBlur={() => markFieldTouched('pitchCircleRight')}
                  step={1}
                  min={1}
                  max={100}
                  error={visibleFieldErrors.pitchCircleRight}
                  placeholder={t('input.pcdRightPlaceholder')}
                />
                <FieldError id="pitchCircleRight-error" message={visibleFieldErrors.pitchCircleRight} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="block text-sm font-medium text-fg-muted">{t('input.flangeDistanceLeft')}</label>
                  <HelpButton topic="flangeDistance" onOpen={setHelpTopic} />
                </div>
                <NumberInput
                  id="flangeDistanceLeft"
                  label={t('input.flangeDistanceLeft')}
                  value={inputs.flangeDistanceLeft}
                  onChange={(value) => handleInputChange('flangeDistanceLeft', value)}
                  onBlur={() => markFieldTouched('flangeDistanceLeft')}
                  step={1}
                  min={1}
                  max={100}
                  error={visibleFieldErrors.flangeDistanceLeft}
                  placeholder={t('input.flangeLeftPlaceholder')}
                />
                <FieldError id="flangeDistanceLeft-error" message={visibleFieldErrors.flangeDistanceLeft} />
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="block text-sm font-medium text-fg-muted">{t('input.flangeDistanceRight')}</label>
                  <HelpButton topic="flangeDistance" onOpen={setHelpTopic} />
                </div>
                <NumberInput
                  id="flangeDistanceRight"
                  label={t('input.flangeDistanceRight')}
                  value={inputs.flangeDistanceRight}
                  onChange={(value) => handleInputChange('flangeDistanceRight', value)}
                  onBlur={() => markFieldTouched('flangeDistanceRight')}
                  step={1}
                  min={1}
                  max={100}
                  error={visibleFieldErrors.flangeDistanceRight}
                  placeholder={t('input.flangeRightPlaceholder')}
                />
                <FieldError id="flangeDistanceRight-error" message={visibleFieldErrors.flangeDistanceRight} />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="block text-sm font-medium text-fg-muted">{t('input.spokeHoleDiameter')}</label>
                <HelpButton topic="spokeHoleDiameter" onOpen={setHelpTopic} />
              </div>
              <NumberInput
                id="spokeHoleDiameter"
                label={t('input.spokeHoleDiameter')}
                value={inputs.spokeHoleDiameter}
                onChange={(value) => handleInputChange('spokeHoleDiameter', value)}
                onBlur={() => markFieldTouched('spokeHoleDiameter')}
                step={0.1}
                min={1.0}
                max={3.0}
                error={visibleFieldErrors.spokeHoleDiameter}
                placeholder={t('input.spokeHolePlaceholder')}
              />
              <FieldError id="spokeHoleDiameter-error" message={visibleFieldErrors.spokeHoleDiameter} />
            </div>
          </FieldGroup>

          <FieldGroup
            label={t('input.group.lacing')}
            icon={<Waypoints aria-hidden="true" className={sectionHeadingIcon} />}
          >
            <div>
              {/* label ではなく span + aria-labelledby。radiogroup は単一の
                  フォームコントロールではないので label/for では結びつかない。
                  元の <label> は htmlFor を持っておらず既に未関連付けだったので、
                  これは退行ではなく a11y 上の改善。 */}
              <span id="numberOfSpokes-label" className="block text-sm font-medium text-fg-muted mb-1">
                {t('input.numberOfSpokes')}
              </span>
              <SegmentedControl
                name="numberOfSpokes"
                labelledBy="numberOfSpokes-label"
                value={inputs.numberOfSpokes}
                options={spokeCountSegments}
                onChange={(value) => handleInputChange('numberOfSpokes', value)}
                onBlur={() => markFieldTouched('numberOfSpokes')}
                invalid={visibleFieldErrors.numberOfSpokes !== undefined}
                describedBy={visibleFieldErrors.numberOfSpokes !== undefined ? 'numberOfSpokes-error' : undefined}
              />
              <FieldError id="numberOfSpokes-error" message={visibleFieldErrors.numberOfSpokes} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <span id="crossingsLeft-label" className="block text-sm font-medium text-fg-muted">{t('input.crossingsLeft')}</span>
                  <HelpButton topic="crossings" onOpen={setHelpTopic} />
                </div>
                <SegmentedControl
                  name="crossingsLeft"
                  labelledBy="crossingsLeft-label"
                  value={inputs.crossingsLeft}
                  options={crossingSegments}
                  onChange={(value) => handleInputChange('crossingsLeft', value)}
                  onBlur={() => markFieldTouched('crossingsLeft')}
                  invalid={visibleFieldErrors.crossingsLeft !== undefined}
                  describedBy={visibleFieldErrors.crossingsLeft !== undefined ? 'crossingsLeft-error' : undefined}
                />
                <RadialHint />
                <FieldError id="crossingsLeft-error" message={visibleFieldErrors.crossingsLeft} />
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <span id="crossingsRight-label" className="block text-sm font-medium text-fg-muted">{t('input.crossingsRight')}</span>
                  <HelpButton topic="crossings" onOpen={setHelpTopic} />
                </div>
                <SegmentedControl
                  name="crossingsRight"
                  labelledBy="crossingsRight-label"
                  value={inputs.crossingsRight}
                  options={crossingSegments}
                  onChange={(value) => handleInputChange('crossingsRight', value)}
                  onBlur={() => markFieldTouched('crossingsRight')}
                  invalid={visibleFieldErrors.crossingsRight !== undefined}
                  describedBy={visibleFieldErrors.crossingsRight !== undefined ? 'crossingsRight-error' : undefined}
                />
                <RadialHint />
                <FieldError id="crossingsRight-error" message={visibleFieldErrors.crossingsRight} />
              </div>
            </div>
          </FieldGroup>

        </div>
      </div>

      {/* 結果はシート内の帯。角丸を持たせず、上のハイラインで区切る。
          まだそこまでスクロールしていない間は画面下端にドックして縮む */}
      <ResultBand
        results={currentResults}
        heading={t('results.heading')}
        placeholder={t('results.placeholder')}
        leftLabel={resultsLeftText}
        rightLabel={resultsRightText}
        isCompactViewport={isCompactViewport}
        bandRef={bandRef}
      />

      {/* 計算結果に対してできることは、この 1 行にすべて集約する (#102)。
          計算名の入力も保存済みの一覧も比較も、常設の区画は持たずダイアログ側へ
          —— 帯の下に積み上がっていた縦の区画がボタン 1 行になる */}
      <ActionBar
        onShare={shareCalculation}
        onSave={() => setShowSaveDialog(true)}
        onExportJson={exportToJSON}
        onImportJson={() => fileInputRef.current?.click()}
        onCompare={() => setShowCompare(true)}
        hasResults={hasValidResults}
        savedCount={savedCalculations.length}
      />
      {/* JSON 入力の実体。バーのボタンから click() で開くので画面には出さない ——
          file input は見た目を作れないので、以前は label + span を押させていた */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={loadFromJSON}
        className="hidden"
      />
      </div>

      {/* JSON 出力。中身は textarea 1 枚で、書き出し先はフッタの 2 つが決める。
          閉じるボタンは持たない —— 見出しの × と Escape で足りているものを
          フッタにもう 1 つ置くと、去就と道具立てが同じ列に混ざる (#107)。
          残る 2 つはラベルを持たないアイコンボタンなので、名前は aria-label が与える
          (ActionBar の sr-only span 方式は、あちらが sm 以上でラベルを見せるためのもの)。
          クラスが btnSecondary ではなく btnSecondaryIcon なのはそのため —— ラベルの
          無い箱に px-4 を残すと、20px のアイコン 1 つに対して 54px 幅の枠だけが
          大きい箱になり、基準の ActionBar より一回り大きく見える (#110)。
          区切り線も伏せる —— textarea が自前の枠を持っているので、そのすぐ下に
          もう 1 本引くと二重線になる (#113) */}
      <Modal
        isOpen={showJsonOutput}
        onClose={() => setShowJsonOutput(false)}
        title={t('results.jsonOutput')}
        widthClass="max-w-2xl"
        footerAlign="start"
        showFooterDivider={false}
        footer={
          <>
            <button
              onClick={copyToClipboard}
              aria-label={t('buttons.copyToClipboard')}
              title={t('buttons.copyToClipboard')}
              className={btnSecondaryIcon}
            >
              <Copy className={btnIcon} aria-hidden="true" />
            </button>
            <button
              onClick={downloadJSON}
              aria-label={t('buttons.downloadJson')}
              title={t('buttons.downloadJson')}
              className={btnSecondaryIcon}
            >
              <Download className={btnIcon} aria-hidden="true" />
            </button>
          </>
        }
      >
        <textarea
          value={jsonData}
          readOnly
          className="min-h-64 w-full flex-1 resize-none rounded-md border border-line-strong bg-sunken p-3 font-mono text-sm text-fg"
        />
      </Modal>

      {/* 保存 —— 計算名を付けて保存することと、保存済みを読む・消すことをまとめて持つ */}
      <SaveDialog
        isOpen={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        name={calculationName}
        onNameChange={setCalculationName}
        onSave={handleSaveRequest}
        canSave={hasValidResults}
        savedCalculations={savedCalculations}
        loadFailure={savedDataLoadStatus === 'ok' ? undefined : savedDataLoadStatus}
        onLoad={handleLoadRequest}
        onDelete={deleteCalculation}
        leftLabel={resultsLeftText}
        rightLabel={resultsRightText}
      />

      {/* ホイール比較。選択は閉じても保持する (compareA / compareB は App が持つ) */}
      <Modal
        isOpen={showCompare}
        onClose={() => setShowCompare(false)}
        title={t('compare.toggle')}
        widthClass="max-w-2xl"
      >
        <CompareWheels
          options={wheelOptions}
          selectedA={compareA}
          selectedB={compareB}
          onChangeA={setCompareA}
          onChangeB={setCompareB}
        />
      </Modal>

      {/* 削除確認。保存ダイアログの上に開く */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        title={t('dialog.deleteConfirm.title')}
        message={t('dialog.deleteConfirm.message')}
      />

      {/* Help modal */}
      <HelpModal topic={helpTopic} onClose={() => setHelpTopic(null)} />
    </>
  );
};

export default SpokeLengthCalculator;
