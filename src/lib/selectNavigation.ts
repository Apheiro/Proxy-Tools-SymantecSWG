export type SelectSearchOption = {
  text: string;
  disabled?: boolean;
};

export function nextSelectIndex(
  options: readonly SelectSearchOption[],
  current: number,
  key: 'ArrowUp' | 'ArrowDown' | 'Home' | 'End',
): number {
  const direction = key === 'ArrowUp' || key === 'End' ? -1 : 1;
  const start =
    key === 'Home'
      ? 0
      : key === 'End'
        ? options.length - 1
        : current + direction;
  for (
    let index = start;
    index >= 0 && index < options.length;
    index += direction
  ) {
    if (!options[index].disabled) return index;
  }
  return current;
}

export function findSelectMatch(
  options: readonly SelectSearchOption[],
  current: number,
  search: string,
): number {
  if (!search) return -1;
  const repeated = [...search].every(
    (character) => character === search[0],
  );
  const query = (repeated ? search[0] : search).toLocaleLowerCase();
  // Repeated letters cycle matches; a longer prefix can keep the current match.
  const start = query.length > 1 ? Math.max(0, current) : current + 1;
  for (let offset = 0; offset < options.length; offset++) {
    const index = (start + offset) % options.length;
    if (
      !options[index].disabled &&
      options[index].text.toLocaleLowerCase().startsWith(query)
    ) {
      return index;
    }
  }
  return -1;
}
