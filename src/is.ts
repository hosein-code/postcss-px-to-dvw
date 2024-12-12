export function getType(obj: unknown) {
    return Object.prototype.toString.call(obj).slice(8, -1).toLowerCase();
};

// 是否是数组
export function isArray<T = unknown>(obj: unknown): obj is Array<T> {
  return getType(obj) === "array";
}

// 是否是正则
export function isRegExp(obj: unknown): obj is RegExp {
  return getType(obj) === "regexp";
}

// 是否是字符串
export function isString(obj: unknown): obj is String {
  return getType(obj) === "string";
}

// s是否是对象
export function isObject(obj: unknown): obj is Object {
  return getType(obj) === "object";
}