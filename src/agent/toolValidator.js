// 参数校验：工具执行前的统一关卡。
// 学自 pi 的 validateToolArguments（packages/ai/src/utils/validation.ts:278）：
//   - 类型强转（coerceTypes："12" → 12）
//   - 校验失败抛带字段路径 + 原始参数的错误，回给模型让它重发
//
// 两个入口：
//   validateToolArguments —— runner 用，输入是模型给的 JSON 字符串，抛普通 Error
//   validateToolArgsObject —— confirmAction 用，输入是已解析对象，抛 BizError.badRequest
// 公共内核 validateArgsObject 通过 throwFn 参数区分抛什么错误。

const Ajv = require('ajv');
const { BizError } = require('../utils/response');

const ajv = new Ajv({
  coerceTypes: true, // "12" → 12，对应 pi 的 Value.Convert
  useDefaults: true, // parameters 里的 default 生效
  allErrors: true, // 一次报全部错，不是第一个
});

// 按 tool.name 缓存编译后的 validator。schema 不变就不重复编译。
const validatorCache = new Map();

function getValidator(tool) {
  if (!validatorCache.has(tool.name)) {
    validatorCache.set(tool.name, ajv.compile(tool.parameters));
  }
  return validatorCache.get(tool.name);
}

// ajv 8.x 用 instancePath（"/id"），归一化成可读的 "id"。
function formatErrorPath(error) {
  const path = error.instancePath || ''; // 形如 "/id" 或 "/nested/key"
  const cleaned = path.replace(/^\//, '').replace(/\//g, '.');
  return cleaned || 'root';
}

function formatErrors(tool, errors) {
  const details = (errors || [])
    .map((e) => `  - ${formatErrorPath(e)}: ${e.message}`)
    .join('\n');
  return `工具 "${tool.name}" 参数校验失败：\n${details}`;
}

/**
 * 校验【已解析的 args 对象】。两个入口的公共内核。
 * @param {object} tool  toolRegistry 里的工具定义
 * @param {object} args  已解析的参数对象
 * @param {Function} throwFn  (message) => 抛出的错误（Error 或 BizError.badRequest）
 * @returns 校验并强转后的 args（coerceTypes 原地改写了副本）
 */
function validateArgsObject(tool, args, throwFn) {
  const validate = getValidator(tool);
  const target = { ...(args || {}) }; // 复制，coerceTypes 会原地改写
  if (validate(target)) return target;

  const message = formatErrors(tool, validate.errors);
  throwFn(message);
}

/**
 * 【runner 入口】解析模型给的原始 JSON 字符串并校验。
 * 失败抛普通 Error —— runner 的 catch 会转成 tool_result 回给模型，让它重发。
 * runner 的 catch 不挑错误类型（errorStr = err.message），所以这里用 Error 即可。
 *
 * @param {object} tool
 * @param {string|null|undefined} rawArguments  模型给的 JSON 字符串
 * @returns {object} 校验并强转后的 args
 * @throws {Error} 解析或校验失败
 */
function validateToolArguments(tool, rawArguments) {
  let args;
  try {
    args = rawArguments ? JSON.parse(rawArguments) : {};
  } catch (err) {
    throw new Error(
      `工具 "${tool.name}" 的参数不是合法 JSON：${err.message}\n\n收到的内容：\n${rawArguments}`,
      { cause: err },
    );
  }
  return validateArgsObject(tool, args, (msg) => {
    throw new Error(msg);
  });
}

/**
 * 【confirmAction 入口】校验前端传来的 args 对象。
 * 失败抛 BizError.badRequest —— Koa error 中间件统一处理成 HTTP 400。
 *
 * @param {object} tool
 * @param {object} args  前端传来的已解析对象
 * @returns {object} 校验并强转后的 args
 * @throws {BizError} 校验失败
 */
function validateToolArgsObject(tool, args) {
  return validateArgsObject(tool, args, (msg) => {
    throw BizError.badRequest(msg);
  });
}

module.exports = {
  validateToolArguments,
  validateToolArgsObject,
};
