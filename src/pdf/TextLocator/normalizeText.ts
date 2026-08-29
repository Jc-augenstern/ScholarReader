const UNICODE_SPACE = /[\s\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export type NormalizedText = {
  text: string;
  /** For every normalized UTF-16 code unit, the source UTF-16 offset it came from. */
  indexMap: number[];
};

export function normalizeTextWithMap(value: string): NormalizedText {
  const tokens: Array<{ value: string; sourceIndex: number; whitespace: boolean }> = [];
  let sourceIndex = 0;
  for (const character of value) {
    const width = character.length;
    if (character !== "\u00ad") {
      const folded = character.normalize("NFKC");
      for (const next of folded) {
        tokens.push({
          value: UNICODE_SPACE.test(next) ? " " : next,
          sourceIndex,
          whitespace: UNICODE_SPACE.test(next),
        });
      }
    }
    sourceIndex += width;
  }

  const output: string[] = [];
  const indexMap: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.whitespace) {
      output.push(token.value);
      for (let unit = 0; unit < token.value.length; unit += 1) indexMap.push(token.sourceIndex);
      continue;
    }

    let nextIndex = index + 1;
    while (nextIndex < tokens.length && tokens[nextIndex].whitespace) nextIndex += 1;
    const previous = output[output.length - 1] ?? "";
    const beforeHyphen = output[output.length - 2] ?? "";
    const next = tokens[nextIndex]?.value ?? "";
    const joinsHyphenatedWord = previous === "-" && WORD_CHARACTER.test(beforeHyphen) && WORD_CHARACTER.test(next);
    if (!joinsHyphenatedWord && output.length && output[output.length - 1] !== " " && nextIndex < tokens.length) {
      output.push(" ");
      indexMap.push(token.sourceIndex);
    }
    index = nextIndex - 1;
  }

  return { text: output.join(""), indexMap };
}

export function normalizeText(value: string): string {
  return normalizeTextWithMap(value).text;
}
