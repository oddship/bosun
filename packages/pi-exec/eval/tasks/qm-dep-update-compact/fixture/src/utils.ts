import _ from "lodash";

export function deepClone<T>(obj: T): T {
  return _.cloneDeep(obj);
}

export function pickFields<T extends object>(obj: T, fields: string[]): Partial<T> {
  return _.pick(obj, fields) as Partial<T>;
}

export function formatName(first: string, last: string): string {
  return _.capitalize(first) + " " + _.capitalize(last);
}
